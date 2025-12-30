import { Router } from 'express'
import db from '../db/index.js'
import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import { CloudinaryStorage } from 'multer-storage-cloudinary'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const router = Router()

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
})

// Check if Cloudinary is configured
const isCloudinaryConfigured = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
)

// Configure storage - Cloudinary if available, else local
let upload

if (isCloudinaryConfigured) {
    console.log('📁 Using Cloudinary for file storage')
    console.log('📁 Cloud name:', process.env.CLOUDINARY_CLOUD_NAME)

    const cloudStorage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'choir-songs',
            resource_type: 'auto', // Auto-detect file type
            type: 'upload', // Public upload (not private/authenticated)
            public_id: (req, file) => {
                const name = `song_${Date.now()}`
                console.log('📤 Uploading file:', file.originalname, 'as', name)
                return name
            }
        }
    })
    upload = multer({ storage: cloudStorage })
} else {
    console.log('📁 Using local file storage (development mode)')
    const localStorage = multer.diskStorage({
        destination: path.join(__dirname, '../../uploads/songs'),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname)
            cb(null, `song_${Date.now()}${ext}`)
        }
    })
    upload = multer({
        storage: localStorage,
        fileFilter: (req, file, cb) => {
            if (file.mimetype === 'application/pdf') {
                cb(null, true)
            } else {
                cb(new Error('Only PDF files allowed'))
            }
        },
        limits: { fileSize: 10 * 1024 * 1024 }
    })
}

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

// GET /api/songs/uncategorized - Get songs without any category
router.get('/uncategorized', getUser, (req, res) => {
    const songs = db.prepare(`
        SELECT s.* 
        FROM songs s
        LEFT JOIN song_categories sc ON s.id = sc.song_id
        WHERE sc.song_id IS NULL AND s.is_public = 1
        ORDER BY s.created_at DESC
    `).all()

    res.json({
        songs: songs.map(s => ({
            id: s.id,
            title: s.title,
            author: s.author,
            pdfPath: s.pdf_path,
            categories: []
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
        // Get file URL - Cloudinary returns full URL, local needs path
        let pdfUrl = null
        if (req.file) {
            if (req.file.path && req.file.path.startsWith('http')) {
                // Cloudinary URL
                pdfUrl = req.file.path
            } else if (req.file.filename) {
                // Local file
                pdfUrl = `/uploads/songs/${req.file.filename}`
            }
        }

        const result = db.prepare(`
      INSERT INTO songs (title, author, pdf_path, key_signature, voices, difficulty, created_by, is_public)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            title.trim(),
            author?.trim() || null,
            pdfUrl,
            key?.trim() || null,
            voices?.trim() || null,
            difficulty?.trim() || null,
            req.user.id,
            choirId ? 0 : 1
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
                title: title.trim(),
                pdfPath: pdfUrl
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

// POST /api/songs/:songId/send-pdf - Send PDF to user via Telegram bot
router.post('/:songId/send-pdf', getUser, async (req, res) => {
    try {
        const { songId } = req.params

        // Get song
        const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId)
        if (!song || !song.pdf_path) {
            return res.status(404).json({ error: 'Song or PDF not found' })
        }

        // Get user's telegram_id
        const telegramId = req.user.telegram_id
        if (!telegramId) {
            return res.status(400).json({ error: 'Telegram ID not found' })
        }

        // Get bot instance from app
        const bot = req.app.get('bot')
        if (!bot) {
            return res.status(500).json({ error: 'Bot not configured' })
        }

        // Send document via bot
        await bot.api.sendDocument(telegramId, song.pdf_path, {
            caption: `🎵 ${song.title}${song.author ? `\n👤 ${song.author}` : ''}`
        })

        res.json({ success: true, message: 'PDF sent to Telegram' })
    } catch (err) {
        console.error('Error sending PDF:', err)
        res.status(500).json({ error: 'Failed to send PDF' })
    }
})

// PUT /api/songs/:id/category - Update song category
router.put('/:id/category', getUser, (req, res) => {
    try {
        const { id } = req.params
        const { categoryId } = req.body

        console.log('PUT /api/songs/:id/category - id:', id, 'categoryId:', categoryId)

        if (!categoryId) {
            return res.status(400).json({ error: 'Category ID required' })
        }

        const songId = parseInt(id)
        const catId = parseInt(categoryId)

        // Check song exists
        const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId)
        if (!song) {
            return res.status(404).json({ error: 'Song not found' })
        }

        // Check category exists
        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId)
        if (!category) {
            return res.status(404).json({ error: 'Category not found' })
        }

        // Remove old categories
        db.prepare('DELETE FROM song_categories WHERE song_id = ?').run(songId)

        // Add new category
        db.prepare('INSERT INTO song_categories (song_id, category_id) VALUES (?, ?)').run(songId, catId)

        console.log('Category updated successfully for song', songId)
        res.json({ success: true })
    } catch (err) {
        console.error('Error updating category:', err)
        res.status(500).json({ error: 'Failed to update category' })
    }
})

export default router
