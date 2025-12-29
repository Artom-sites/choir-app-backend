import { Router } from 'express'
import crypto from 'crypto'
import db from '../db/index.js'

const router = Router()

// Verify Telegram WebApp data
function verifyTelegramData(initData, botToken) {
    const urlParams = new URLSearchParams(initData)
    const hash = urlParams.get('hash')
    urlParams.delete('hash')

    // Sort params
    const params = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')

    // Create secret key
    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest()

    // Calculate hash
    const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex')

    return calculatedHash === hash
}

// Parse user from initData
function parseUserFromInitData(initData) {
    const urlParams = new URLSearchParams(initData)
    const userJson = urlParams.get('user')
    if (!userJson) return null

    try {
        return JSON.parse(userJson)
    } catch {
        return null
    }
}

// POST /api/auth - Authenticate via Telegram initData
router.post('/auth', (req, res) => {
    const { initData } = req.body

    if (!initData) {
        return res.status(400).json({ error: 'Missing initData' })
    }

    // In development, allow bypass
    const isDev = process.env.NODE_ENV !== 'production'

    if (!isDev) {
        const isValid = verifyTelegramData(initData, process.env.BOT_TOKEN)
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid initData' })
        }
    }

    const telegramUser = parseUserFromInitData(initData)

    if (!telegramUser) {
        return res.status(400).json({ error: 'Cannot parse user' })
    }

    // Get or create user
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramUser.id))

    if (!user) {
        const stmt = db.prepare(`
      INSERT INTO users (telegram_id, telegram_name, telegram_username)
      VALUES (?, ?, ?)
    `)
        stmt.run(
            String(telegramUser.id),
            telegramUser.first_name + (telegramUser.last_name ? ' ' + telegramUser.last_name : ''),
            telegramUser.username || null
        )
        user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramUser.id))
    }

    // Get user's choirs
    const choirs = db.prepare(`
    SELECT c.*, cm.role 
    FROM choirs c
    JOIN choir_members cm ON c.id = cm.choir_id
    WHERE cm.user_id = ?
    ORDER BY cm.joined_at DESC
  `).all(user.id)

    res.json({
        user: {
            id: user.id,
            telegramId: user.telegram_id,
            name: user.telegram_name,
            username: user.telegram_username,
            isSuperadmin: !!user.is_superadmin
        },
        choirs: choirs.map(c => ({
            id: c.id,
            name: c.name,
            inviteCode: c.invite_code,
            role: c.role,
            isOwner: c.owner_id === user.id
        }))
    })
})

// POST /api/auth/dev - Development auth (no Telegram)
router.post('/auth/dev', (req, res) => {
    const { telegramId, name } = req.body

    if (!telegramId) {
        return res.status(400).json({ error: 'Missing telegramId' })
    }

    // Get or create user
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId))

    if (!user) {
        db.prepare(`
      INSERT INTO users (telegram_id, telegram_name, is_superadmin)
      VALUES (?, ?, 1)
    `).run(String(telegramId), name || 'Dev User')
        user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId))
    }

    // Get user's choirs
    const choirs = db.prepare(`
    SELECT c.*, cm.role 
    FROM choirs c
    JOIN choir_members cm ON c.id = cm.choir_id
    WHERE cm.user_id = ?
  `).all(user.id)

    res.json({
        user: {
            id: user.id,
            telegramId: user.telegram_id,
            name: user.telegram_name,
            isSuperadmin: !!user.is_superadmin
        },
        choirs: choirs.map(c => ({
            id: c.id,
            name: c.name,
            inviteCode: c.invite_code,
            role: c.role,
            isOwner: c.owner_id === user.id
        }))
    })
})

export default router
