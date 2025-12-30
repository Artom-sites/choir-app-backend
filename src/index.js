import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'

import { createBot } from './bot/index.js'
import authRouter from './api/auth.js'
import choirsRouter from './api/choirs.js'
import songsRouter from './api/songs.js'
import repertoireRouter from './api/repertoire.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = process.env.PORT || 3000
const BOT_TOKEN = process.env.BOT_TOKEN
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:5173'

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required in .env')
    process.exit(1)
}

// Create Telegram bot first (needed for API)
const bot = createBot(BOT_TOKEN, WEBAPP_URL)

// Create Express app
const app = express()

// Store bot instance in app for API access
app.set('bot', bot)

app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', WEBAPP_URL],
    credentials: true
}))
app.use(express.json())

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// API routes
app.use('/api', authRouter)
app.use('/api/choirs', choirsRouter)
app.use('/api/songs', songsRouter)
app.use('/api/repertoire', repertoireRouter)

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Start Express server
app.listen(PORT, () => {
    console.log(`🚀 API server running on http://localhost:${PORT}`)
})

// Start Telegram bot
bot.start({
    onStart: (botInfo) => {
        console.log(`🤖 Bot @${botInfo.username} is running!`)
        console.log(`📱 WebApp URL: ${WEBAPP_URL}`)
    }
})

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...')
    bot.stop()
    process.exit(0)
})

process.on('SIGTERM', () => {
    bot.stop()
    process.exit(0)
})
