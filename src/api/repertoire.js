import { Router } from 'express'
import db from '../db/index.js'

const router = Router()

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

// Check choir membership
function checkChoirMember(req, res, next) {
    const choirId = req.params.choirId
    if (!choirId) {
        return res.status(400).json({ error: 'Choir ID required' })
    }

    const membership = db.prepare(`
    SELECT * FROM choir_members WHERE choir_id = ? AND user_id = ?
  `).get(choirId, req.user.id)

    if (!membership) {
        return res.status(403).json({ error: 'Not a member of this choir' })
    }

    req.choirId = parseInt(choirId)
    req.choirRole = membership.role
    next()
}

// GET /api/repertoire/:choirId/today - Get today's repertoire
router.get('/:choirId/today', getUser, checkChoirMember, (req, res) => {
    const today = new Date().toISOString().split('T')[0]

    const repertoire = db.prepare(`
    SELECT r.id, r.date FROM repertoire r
    WHERE r.choir_id = ? AND r.date = ?
  `).get(req.choirId, today)

    if (!repertoire) {
        return res.json({
            date: today,
            songs: []
        })
    }

    const songs = db.prepare(`
    SELECT s.*, rs.sort_order,
      GROUP_CONCAT(c.name) as category_names,
      GROUP_CONCAT(c.id) as category_ids
    FROM songs s
    JOIN repertoire_songs rs ON s.id = rs.song_id
    LEFT JOIN song_categories sc ON s.id = sc.song_id
    LEFT JOIN categories c ON sc.category_id = c.id
    WHERE rs.repertoire_id = ?
    GROUP BY s.id, rs.sort_order
    ORDER BY rs.sort_order
  `).all(repertoire.id)

    res.json({
        date: repertoire.date,
        songs: songs.map(s => ({
            id: s.id,
            title: s.title,
            author: s.author,
            pdfPath: s.pdf_path,
            key: s.key_signature,
            voices: s.voices,
            difficulty: s.difficulty,
            sortOrder: s.sort_order,
            categories: s.category_names ? s.category_names.split(',').map((name, i) => ({
                id: s.category_ids?.split(',')[i],
                name
            })) : []
        }))
    })
})

// GET /api/repertoire/:choirId/:date - Get repertoire for specific date
router.get('/:choirId/:date', getUser, checkChoirMember, (req, res) => {
    const { date } = req.params

    const repertoire = db.prepare(`
    SELECT r.id, r.date FROM repertoire r
    WHERE r.choir_id = ? AND r.date = ?
  `).get(req.choirId, date)

    if (!repertoire) {
        return res.json({
            date,
            songs: []
        })
    }

    const songs = db.prepare(`
    SELECT s.*, rs.sort_order,
      GROUP_CONCAT(c.name) as category_names
    FROM songs s
    JOIN repertoire_songs rs ON s.id = rs.song_id
    LEFT JOIN song_categories sc ON s.id = sc.song_id
    LEFT JOIN categories c ON sc.category_id = c.id
    WHERE rs.repertoire_id = ?
    GROUP BY s.id, rs.sort_order
    ORDER BY rs.sort_order
  `).all(repertoire.id)

    res.json({
        date: repertoire.date,
        songs: songs.map(s => ({
            id: s.id,
            title: s.title,
            author: s.author,
            sortOrder: s.sort_order,
            categories: s.category_names ? s.category_names.split(',').map(name => ({ name })) : []
        }))
    })
})

// POST /api/repertoire/:choirId - Set repertoire (admin only)
router.post('/:choirId', getUser, checkChoirMember, (req, res) => {
    if (req.choirRole !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' })
    }

    const { date, songIds } = req.body

    if (!date) {
        return res.status(400).json({ error: 'Date is required' })
    }

    if (!Array.isArray(songIds)) {
        return res.status(400).json({ error: 'songIds must be an array' })
    }

    try {
        // Delete existing repertoire for this date
        const existing = db.prepare(`
      SELECT id FROM repertoire WHERE choir_id = ? AND date = ?
    `).get(req.choirId, date)

        if (existing) {
            db.prepare('DELETE FROM repertoire_songs WHERE repertoire_id = ?').run(existing.id)
            db.prepare('DELETE FROM repertoire WHERE id = ?').run(existing.id)
        }

        // Create new repertoire
        const result = db.prepare(`
      INSERT INTO repertoire (choir_id, date, created_by) VALUES (?, ?, ?)
    `).run(req.choirId, date, req.user.id)

        const repertoireId = result.lastInsertRowid

        // Add songs
        const insertSong = db.prepare(`
      INSERT INTO repertoire_songs (repertoire_id, song_id, sort_order) VALUES (?, ?, ?)
    `)

        for (let i = 0; i < songIds.length; i++) {
            insertSong.run(repertoireId, songIds[i], i + 1)
        }

        res.json({
            success: true,
            repertoireId,
            date,
            songCount: songIds.length
        })
    } catch (err) {
        console.error('Error setting repertoire:', err)
        res.status(500).json({ error: 'Failed to set repertoire' })
    }
})

// DELETE /api/repertoire/:choirId/:date - Clear repertoire for date
router.delete('/:choirId/:date', getUser, checkChoirMember, (req, res) => {
    if (req.choirRole !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' })
    }

    const { date } = req.params

    const existing = db.prepare(`
    SELECT id FROM repertoire WHERE choir_id = ? AND date = ?
  `).get(req.choirId, date)

    if (existing) {
        db.prepare('DELETE FROM repertoire_songs WHERE repertoire_id = ?').run(existing.id)
        db.prepare('DELETE FROM repertoire WHERE id = ?').run(existing.id)
    }

    res.json({ success: true })
})

export default router
