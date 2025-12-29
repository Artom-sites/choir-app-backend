import { Router } from 'express'
import db from '../db/index.js'
import multer from 'multer'
import path from 'path'
import { nanoid } from 'nanoid'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const router = Router()

// Configure multer for PDF uploads
const storage = multer.diskStorage({
    destination: path.join(__dirname, '../../uploads/songs'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname)
        cb(null, `${nanoid()}_${Date.now()}${ext}`)
    }
})

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true)
        } else {
            cb(new Error('Only PDF files allowed'))
        }
    },
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
})

// Middleware to get user
function getUser(req, res, next) {
    const userId = req.headers['x-user-id']
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user) {
        return res.status(401).json({ error: 'User not found' })
    }

    req.user = user
    next()
}

// Check choir admin
function checkChoirAdmin(req, res, next) {
    const choirId = req.params.choirId || req.body.choirId
    if (!choirId) {
        return res.status(400).json({ error: 'Choir ID required' })
    }

    const membership = db.prepare(`
    SELECT * FROM choir_members WHERE choir_id = ? AND user_id = ?
  `).get(choirId, req.user.id)

    if (!membership || membership.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' })
    }

    req.choirId = choirId
    next()
}

// GET /api/songs - Get all public songs or choir songs
router.get('/', getUser, (req, res) => {
    const { choirId, categoryId, search } = req.query

    let query = `
    SELECT s.*, 
      GROUP_CONCAT(DISTINCT c.name) as category_names,
      GROUP_CONCAT(DISTINCT c.id) as category_ids,
      GROUP_CONCAT(DISTINCT c.icon) as category_icons
    FROM songs s
    LEFT JOIN song_categories sc ON s.id = sc.song_id
    LEFT JOIN categories c ON sc.category_id = c.id
  `

    const params = []

    if (choirId) {
        // Get songs in choir library
        const membership = db.prepare(`
      SELECT * FROM choir_members WHERE choir_id = ? AND user_id = ?
    `).get(choirId, req.user.id)

        if (!membership) {
            return res.status(403).json({ error: 'Not a member' })
        }

        query += `
      JOIN choir_songs cs ON s.id = cs.song_id AND cs.choir_id = ?
    `
        params.push(choirId)
    } else {
        query += ` WHERE s.is_public = 1 `
    }

    if (categoryId) {
        query += choirId ? ' WHERE ' : ' AND '
        query += ` sc.category_id = ? `
        params.push(categoryId)
    }

    if (search) {
        query += (choirId || categoryId) ? ' AND ' : ' WHERE '
        query += ` (s.title LIKE ? OR s.author LIKE ?) `
        params.push(`%${search}%`, `%${search}%`)
    }

    query += ` GROUP BY s.id ORDER BY s.title`

    const songs = db.prepare(query).all(...params)

    res.json({
        songs: songs.map(s => ({
            id: s.id,
            title: s.title,
            author: s.author,
            pdfPath: s.pdf_path,
            key: s.key_signature,
            voices: s.voices,
            difficulty: s.difficulty,
            categories: s.category_names ? s.category_names.split(',').map((name, i) => ({
                id: s.category_ids.split(',')[i],
                name,
                icon: s.category_icons?.split(',')[i]
            })) : []
        }))
    })
})

// GET /api/songs/categories - Get all categories
router.get('/categories', (req, res) => {
    const categories = db.prepare('SELECT * FROM categories ORDER BY id').all()
    res.json({ categories })
})

// GET /api/songs/:id - Get single song
router.get('/:id', getUser, (req, res) => {
    const song = db.prepare(`
    SELECT s.*, 
      GROUP_CONCAT(c.name) as category_names,
      GROUP_CONCAT(c.id) as category_ids,
      GROUP_CONCAT(c.icon) as category_icons
    FROM songs s
    LEFT JOIN song_categories sc ON s.id = sc.song_id
    LEFT JOIN categories c ON sc.category_id = c.id
    WHERE s.id = ?
    GROUP BY s.id
  `).get(req.params.id)

    if (!song) {
        return res.status(404).json({ error: 'Song not found' })
    }

    res.json({
        song: {
            id: song.id,
            title: song.title,
            author: song.author,
            pdfPath: song.pdf_path,
            key: song.key_signature,
            voices: song.voices,
            difficulty: song.difficulty,
            categories: song.category_names ? song.category_names.split(',').map((name, i) => ({
                id: song.category_ids.split(',')[i],
                name,
                icon: song.category_icons?.split(',')[i]
            })) : []
        }
    })
})

// POST /api/songs - Create song (admin only)
router.post('/', getUser, upload.single('pdf'), (req, res) => {
    const { title, author, key, voices, difficulty, categoryIds, choirId } = req.body

    if (!title?.trim()) {
        return res.status(400).json({ error: 'Title is required' })
    }

    // If choirId provided, check admin
    if (choirId) {
        const membership = db.prepare(`
      SELECT * FROM choir_members WHERE choir_id = ? AND user_id = ?
    `).get(choirId, req.user.id)

        if (!membership || membership.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' })
        }
    }

    try {
        const result = db.prepare(`
      INSERT INTO songs (title, author, pdf_path, key_signature, voices, difficulty, created_by, is_public)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            title.trim(),
            author?.trim() || null,
            req.file ? `/uploads/songs/${req.file.filename}` : null,
            key?.trim() || null,
            voices?.trim() || null,
            difficulty?.trim() || null,
            req.user.id,
            choirId ? 0 : 1 // Private if for specific choir
        )

        const songId = result.lastInsertRowid

        // Add categories
        if (categoryIds) {
            const ids = JSON.parse(categoryIds)
            const insertCat = db.prepare('INSERT INTO song_categories (song_id, category_id) VALUES (?, ?)')
            for (const catId of ids) {
                insertCat.run(songId, catId)
            }
        }

        // Add to choir library if choirId provided
        if (choirId) {
            db.prepare('INSERT INTO choir_songs (choir_id, song_id) VALUES (?, ?)').run(choirId, songId)
        }

        res.json({
            song: {
                id: songId,
                title: title.trim()
            }
        })
    } catch (err) {
        console.error('Error creating song:', err)
        res.status(500).json({ error: 'Failed to create song' })
    }
})

// POST /api/songs/choir/:choirId/add/:songId - Add existing song to choir
router.post('/choir/:choirId/add/:songId', getUser, checkChoirAdmin, (req, res) => {
    const { songId } = req.params

    const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId)
    if (!song) {
        return res.status(404).json({ error: 'Song not found' })
    }

    try {
        db.prepare(`
      INSERT OR IGNORE INTO choir_songs (choir_id, song_id) VALUES (?, ?)
    `).run(req.choirId, songId)

        res.json({ success: true })
    } catch (err) {
        console.error('Error adding song to choir:', err)
        res.status(500).json({ error: 'Failed to add song' })
    }
})

// DELETE /api/songs/choir/:choirId/remove/:songId - Remove song from choir
router.delete('/choir/:choirId/remove/:songId', getUser, checkChoirAdmin, (req, res) => {
    const { songId } = req.params

    db.prepare(`
    DELETE FROM choir_songs WHERE choir_id = ? AND song_id = ?
  `).run(req.choirId, songId)

    res.json({ success: true })
})

export default router
