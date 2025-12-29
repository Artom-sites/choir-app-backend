import { Router } from 'express'
import db from '../db/index.js'
import { nanoid } from 'nanoid'

const router = Router()

// Middleware to get user from header
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

// GET /api/choirs - Get user's choirs
router.get('/', getUser, (req, res) => {
    const choirs = db.prepare(`
    SELECT c.*, cm.role,
      (SELECT COUNT(*) FROM choir_members WHERE choir_id = c.id) as member_count,
      (SELECT COUNT(*) FROM choir_songs WHERE choir_id = c.id) as song_count
    FROM choirs c
    JOIN choir_members cm ON c.id = cm.choir_id
    WHERE cm.user_id = ?
    ORDER BY cm.joined_at DESC
  `).all(req.user.id)

    res.json({
        choirs: choirs.map(c => ({
            id: c.id,
            name: c.name,
            inviteCode: c.invite_code,
            role: c.role,
            isOwner: c.owner_id === req.user.id,
            memberCount: c.member_count,
            songCount: c.song_count
        }))
    })
})

// POST /api/choirs - Create new choir
router.post('/', getUser, (req, res) => {
    const { name } = req.body

    if (!name?.trim()) {
        return res.status(400).json({ error: 'Name is required' })
    }

    const inviteCode = nanoid(6).toUpperCase()

    try {
        const result = db.prepare(`
      INSERT INTO choirs (name, invite_code, owner_id) VALUES (?, ?, ?)
    `).run(name.trim(), inviteCode, req.user.id)

        // Add owner as admin
        db.prepare(`
      INSERT INTO choir_members (choir_id, user_id, role) VALUES (?, ?, 'admin')
    `).run(result.lastInsertRowid, req.user.id)

        res.json({
            choir: {
                id: result.lastInsertRowid,
                name: name.trim(),
                inviteCode,
                role: 'admin',
                isOwner: true
            }
        })
    } catch (err) {
        console.error('Error creating choir:', err)
        res.status(500).json({ error: 'Failed to create choir' })
    }
})

// POST /api/choirs/join - Join choir by code
router.post('/join', getUser, (req, res) => {
    const { code } = req.body

    if (!code?.trim()) {
        return res.status(400).json({ error: 'Code is required' })
    }

    const choir = db.prepare('SELECT * FROM choirs WHERE invite_code = ?')
        .get(code.trim().toUpperCase())

    if (!choir) {
        return res.status(404).json({ error: 'Choir not found' })
    }

    // Check if already member
    const existing = db.prepare(`
    SELECT * FROM choir_members WHERE choir_id = ? AND user_id = ?
  `).get(choir.id, req.user.id)

    if (existing) {
        return res.json({
            choir: {
                id: choir.id,
                name: choir.name,
                inviteCode: choir.invite_code,
                role: existing.role,
                isOwner: choir.owner_id === req.user.id
            },
            alreadyMember: true
        })
    }

    try {
        db.prepare(`
      INSERT INTO choir_members (choir_id, user_id, role) VALUES (?, ?, 'member')
    `).run(choir.id, req.user.id)

        res.json({
            choir: {
                id: choir.id,
                name: choir.name,
                inviteCode: choir.invite_code,
                role: 'member',
                isOwner: false
            }
        })
    } catch (err) {
        console.error('Error joining choir:', err)
        res.status(500).json({ error: 'Failed to join choir' })
    }
})

// GET /api/choirs/search - Search choirs by name
router.get('/search', getUser, (req, res) => {
    const { q } = req.query

    if (!q || q.length < 2) {
        return res.json({ choirs: [] })
    }

    const choirs = db.prepare(`
    SELECT c.id, c.name, c.invite_code,
      (SELECT COUNT(*) FROM choir_members WHERE choir_id = c.id) as member_count
    FROM choirs c
    WHERE c.name LIKE ?
    LIMIT 20
  `).all(`%${q}%`)

    res.json({
        choirs: choirs.map(c => ({
            id: c.id,
            name: c.name,
            memberCount: c.member_count
        }))
    })
})

// POST /api/choirs/:id/request-join - Request to join a choir
router.post('/:id/request-join', getUser, (req, res) => {
    const { id } = req.params

    const choir = db.prepare('SELECT * FROM choirs WHERE id = ?').get(id)

    if (!choir) {
        return res.status(404).json({ error: 'Choir not found' })
    }

    // Check if already member
    const existing = db.prepare(`
    SELECT * FROM choir_members WHERE choir_id = ? AND user_id = ?
  `).get(choir.id, req.user.id)

    if (existing) {
        return res.json({
            choir: {
                id: choir.id,
                name: choir.name,
                role: existing.role
            },
            alreadyMember: true
        })
    }

    try {
        // Auto-join as member (in future can be pending approval)
        db.prepare(`
      INSERT INTO choir_members (choir_id, user_id, role) VALUES (?, ?, 'member')
    `).run(choir.id, req.user.id)

        res.json({
            choir: {
                id: choir.id,
                name: choir.name,
                role: 'member'
            }
        })
    } catch (err) {
        console.error('Error requesting to join choir:', err)
        res.status(500).json({ error: 'Failed to join choir' })
    }
})


router.get('/:id', getUser, (req, res) => {
    const { id } = req.params

    // Check membership
    const membership = db.prepare(`
    SELECT * FROM choir_members WHERE choir_id = ? AND user_id = ?
  `).get(id, req.user.id)

    if (!membership) {
        return res.status(403).json({ error: 'Not a member of this choir' })
    }

    const choir = db.prepare('SELECT * FROM choirs WHERE id = ?').get(id)

    if (!choir) {
        return res.status(404).json({ error: 'Choir not found' })
    }

    const memberCount = db.prepare(`
    SELECT COUNT(*) as count FROM choir_members WHERE choir_id = ?
  `).get(id).count

    res.json({
        choir: {
            id: choir.id,
            name: choir.name,
            inviteCode: choir.invite_code,
            role: membership.role,
            isOwner: choir.owner_id === req.user.id,
            memberCount
        }
    })
})

// GET /api/choirs/:id/members - Get choir members
router.get('/:id/members', getUser, (req, res) => {
    const { id } = req.params

    // Check if admin
    const membership = db.prepare(`
    SELECT * FROM choir_members WHERE choir_id = ? AND user_id = ?
  `).get(id, req.user.id)

    if (!membership || membership.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' })
    }

    const members = db.prepare(`
    SELECT u.id, u.telegram_name as name, u.telegram_username as username, 
           cm.role, cm.joined_at
    FROM users u
    JOIN choir_members cm ON u.id = cm.user_id
    WHERE cm.choir_id = ?
    ORDER BY cm.role DESC, cm.joined_at ASC
  `).all(id)

    res.json({ members })
})

// DELETE /api/choirs/:id/leave - Leave choir
router.delete('/:id/leave', getUser, (req, res) => {
    const { id } = req.params

    const choir = db.prepare('SELECT * FROM choirs WHERE id = ?').get(id)

    if (!choir) {
        return res.status(404).json({ error: 'Choir not found' })
    }

    if (choir.owner_id === req.user.id) {
        return res.status(400).json({ error: 'Cannot leave choir you own' })
    }

    db.prepare(`
    DELETE FROM choir_members WHERE choir_id = ? AND user_id = ?
  `).run(id, req.user.id)

    res.json({ success: true })
})

export default router
