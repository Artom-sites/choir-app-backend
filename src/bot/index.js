import { Bot, InlineKeyboard } from 'grammy'
import db from '../db/index.js'
import { nanoid } from 'nanoid'

export function createBot(token, webappUrl) {
    const bot = new Bot(token)

    // Check if HTTPS (production) for WebApp button
    const isHttps = webappUrl.startsWith('https://')

    // Helper: get or create user
    function getOrCreateUser(from) {
        let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(from.id))

        if (!user) {
            const stmt = db.prepare(`
        INSERT INTO users (telegram_id, telegram_name, telegram_username)
        VALUES (?, ?, ?)
      `)
            stmt.run(String(from.id), from.first_name + (from.last_name ? ' ' + from.last_name : ''), from.username || null)
            user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(from.id))
        }

        return user
    }

    // Helper: generate invite code
    function generateInviteCode() {
        return nanoid(6).toUpperCase()
    }

    // Helper: create keyboard with WebApp button (only for HTTPS)
    function createKeyboard() {
        if (isHttps) {
            return new InlineKeyboard().webApp('🎵 Відкрити Репертуар', webappUrl)
        }
        return null
    }

    // /start command
    bot.command('start', async (ctx) => {
        const user = getOrCreateUser(ctx.from)

        await ctx.reply(`Вітаю, ${ctx.from.first_name}! 🎵\n\nВикористовуйте кнопку меню нижче щоб відкрити репертуар.`)
    })

    // /help command
    bot.command('help', async (ctx) => {
        await ctx.reply(
            `🎵 Хоровий Репертуар - Допомога

Для хористів:
/join КОД - Приєднатися до хору
/my_choirs - Переглянути мої хори
/leave КОД - Покинути хор

Для керівників:
/create_choir Назва - Створити новий хор
/choir_info КОД - Інформація про хор`
        )
    })

    // /create_choir command
    bot.command('create_choir', async (ctx) => {
        const user = getOrCreateUser(ctx.from)
        const choirName = ctx.match?.trim()

        if (!choirName) {
            await ctx.reply(
                '❌ Вкажіть назву хору.\n\n' +
                'Приклад: /create_choir Хор Собору'
            )
            return
        }

        const inviteCode = generateInviteCode()

        try {
            const stmt = db.prepare(`
        INSERT INTO choirs (name, invite_code, owner_id) VALUES (?, ?, ?)
      `)
            const result = stmt.run(choirName, inviteCode, user.id)

            // Add owner as admin member
            db.prepare(`
        INSERT INTO choir_members (choir_id, user_id, role) VALUES (?, ?, 'admin')
      `).run(result.lastInsertRowid, user.id)

            const keyboard = createKeyboard()
            const message = `✅ Хор "${choirName}" створено!

🔐 Код для приєднання: ${inviteCode}

Поділіться цим кодом з учасниками хору.
Вони зможуть приєднатися командою:
/join ${inviteCode}`

            if (keyboard) {
                await ctx.reply(message, { reply_markup: keyboard })
            } else {
                await ctx.reply(message)
            }
        } catch (err) {
            console.error('Error creating choir:', err)
            await ctx.reply('❌ Помилка при створенні хору. Спробуйте ще раз.')
        }
    })

    // /join command
    bot.command('join', async (ctx) => {
        const user = getOrCreateUser(ctx.from)
        const code = ctx.match?.trim().toUpperCase()

        if (!code) {
            await ctx.reply(
                '❌ Вкажіть код хору.\n\n' +
                'Приклад: /join ABC123'
            )
            return
        }

        const choir = db.prepare('SELECT * FROM choirs WHERE invite_code = ?').get(code)

        if (!choir) {
            await ctx.reply('❌ Хор з таким кодом не знайдено. Перевірте код і спробуйте ще раз.')
            return
        }

        // Check if already member
        const existing = db.prepare(
            'SELECT * FROM choir_members WHERE choir_id = ? AND user_id = ?'
        ).get(choir.id, user.id)

        if (existing) {
            await ctx.reply(`ℹ️ Ви вже є учасником хору "${choir.name}".`)
            return
        }

        try {
            db.prepare(`
        INSERT INTO choir_members (choir_id, user_id, role) VALUES (?, ?, 'member')
      `).run(choir.id, user.id)

            const keyboard = createKeyboard()
            const message = `✅ Ви приєдналися до хору "${choir.name}"!

Тепер ви можете переглядати репертуар.`

            if (keyboard) {
                await ctx.reply(message, { reply_markup: keyboard })
            } else {
                await ctx.reply(message)
            }
        } catch (err) {
            console.error('Error joining choir:', err)
            await ctx.reply('❌ Помилка при приєднанні. Спробуйте ще раз.')
        }
    })

    // /my_choirs command
    bot.command('my_choirs', async (ctx) => {
        const user = getOrCreateUser(ctx.from)

        const choirs = db.prepare(`
      SELECT c.*, cm.role 
      FROM choirs c
      JOIN choir_members cm ON c.id = cm.choir_id
      WHERE cm.user_id = ?
      ORDER BY cm.joined_at DESC
    `).all(user.id)

        if (choirs.length === 0) {
            await ctx.reply(
                '📋 У вас ще немає хорів.\n\n' +
                'Створіть свій: /create_choir Назва\n' +
                'Або приєднайтесь: /join КОД'
            )
            return
        }

        let message = '🎵 Ваші хори:\n\n'

        for (const choir of choirs) {
            const roleEmoji = choir.role === 'admin' ? '👑' : '🎤'
            const roleText = choir.role === 'admin' ? 'керівник' : 'учасник'
            message += `${roleEmoji} ${choir.name}\n`
            message += `   Код: ${choir.invite_code} (${roleText})\n\n`
        }

        const keyboard = createKeyboard()

        if (keyboard) {
            await ctx.reply(message, { reply_markup: keyboard })
        } else {
            await ctx.reply(message)
        }
    })

    // /leave command
    bot.command('leave', async (ctx) => {
        const user = getOrCreateUser(ctx.from)
        const code = ctx.match?.trim().toUpperCase()

        if (!code) {
            await ctx.reply('❌ Вкажіть код хору. Приклад: /leave ABC123')
            return
        }

        const choir = db.prepare('SELECT * FROM choirs WHERE invite_code = ?').get(code)

        if (!choir) {
            await ctx.reply('❌ Хор з таким кодом не знайдено.')
            return
        }

        if (choir.owner_id === user.id) {
            await ctx.reply('❌ Ви не можете покинути хор, який створили.')
            return
        }

        const result = db.prepare(`
      DELETE FROM choir_members WHERE choir_id = ? AND user_id = ?
    `).run(choir.id, user.id)

        if (result.changes > 0) {
            await ctx.reply(`✅ Ви покинули хор "${choir.name}".`)
        } else {
            await ctx.reply('❌ Ви не є учасником цього хору.')
        }
    })

    // /choir_info command
    bot.command('choir_info', async (ctx) => {
        const user = getOrCreateUser(ctx.from)
        const code = ctx.match?.trim().toUpperCase()

        if (!code) {
            await ctx.reply('❌ Вкажіть код хору. Приклад: /choir_info ABC123')
            return
        }

        const choir = db.prepare('SELECT * FROM choirs WHERE invite_code = ?').get(code)

        if (!choir) {
            await ctx.reply('❌ Хор з таким кодом не знайдено.')
            return
        }

        const membership = db.prepare(`
      SELECT role FROM choir_members WHERE choir_id = ? AND user_id = ?
    `).get(choir.id, user.id)

        if (!membership) {
            await ctx.reply('❌ Ви не є учасником цього хору.')
            return
        }

        const memberCount = db.prepare(`
      SELECT COUNT(*) as count FROM choir_members WHERE choir_id = ?
    `).get(choir.id).count

        const songCount = db.prepare(`
      SELECT COUNT(*) as count FROM choir_songs WHERE choir_id = ?
    `).get(choir.id).count

        await ctx.reply(
            `📋 ${choir.name}

🔐 Код: ${choir.invite_code}
👥 Учасників: ${memberCount}
🎵 Пісень: ${songCount}

Ваша роль: ${membership.role === 'admin' ? '👑 Керівник' : '🎤 Учасник'}`
        )
    })

    // Error handler
    bot.catch((err) => {
        console.error('Bot error:', err)
    })

    return bot
}
