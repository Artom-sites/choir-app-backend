# Choir App Backend

Node.js backend for the Choir Telegram Mini App.

## Environment Variables

Set these in Railway:

- `BOT_TOKEN` - Telegram bot token from @BotFather
- `WEBAPP_URL` - Frontend URL (e.g. https://your-app.vercel.app)
- `PORT` - (auto-set by Railway)

## Endpoints

- `GET /health` - Health check
- `POST /api/auth` - Telegram WebApp auth
- `POST /api/auth/dev` - Development auth
- `GET/POST /api/choirs` - Choir management
- `GET/POST /api/songs` - Song management
- `GET/POST /api/repertoire/:choirId` - Repertoire management
