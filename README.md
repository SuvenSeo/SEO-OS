---
title: SEOS
emoji: 🧠
colorFrom: indigo
colorTo: blue
sdk: docker
pinned: false
---

# SEOS — Personal AI Operating System

A private, cloud-hosted AI chief of staff that manages tasks, memory, reminders, and daily life. Maximally proactive — it runs the day, not the other way around.

## Architecture

```
Telegram ←→ Express Backend (Railway) ←→ Groq AI (llama-3.3-70b)
                    ↕                           ↕
             Supabase (Postgres)        Next.js Dashboard (Vercel)
                    ↑
          GitHub Actions (Cron Jobs)
```

## Quick Start

### 1. Database Setup

1. Create a [Supabase](https://supabase.com) project
2. Go to SQL Editor and run the contents of `supabase/schema.sql`
3. Copy your project URL and service role key

### 2. Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Create a new bot and save the token
3. Send a message to your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to get your chat ID

### 3. Backend

```bash
cd backend
cp .env.example .env
# Fill in all values in .env
npm install
npm run dev
```

### 4. Set Telegram Webhook

Once the backend is running (locally via ngrok or deployed on Railway):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_URL>/webhook/<TOKEN>
```

### 5. Frontend

```bash
cd frontend
cp .env.example .env.local
# Fill in API URL and CRON_SECRET
npm install
npm run dev
```

### 6. GitHub Actions

1. Push this repo to GitHub
2. Add these repository secrets:
   - `RAILWAY_URL` — your Railway deployment URL
   - `CRON_SECRET` — matches backend env

## Environment Variables

### Backend (.env)

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | API key from [console.groq.com](https://console.groq.com) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your personal chat ID |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (not anon) |
| `CRON_SECRET` | Secret token for authenticating cron jobs and API calls |
| `PORT` | Server port (default: 3001) |
| `FRONTEND_URL` | Frontend URL for CORS |

### Frontend (.env.local)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend URL |
| `NEXT_PUBLIC_CRON_SECRET` | Same CRON_SECRET as backend |

## Telegram Commands

| Command | Action |
|---------|--------|
| `/tasks` | Show open tasks grouped by priority |
| `/done [id]` | Mark a task as done |
| `/reminders` | Show upcoming reminders |
| `/memory` | Show core memory |
| `/ideas` | Show raw ideas |
| `/brief` | Trigger morning brief |
| `/review` | Trigger weekly review |

## Scheduled Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| Morning Brief | 8:00am IST daily | Tasks summary + priorities |
| Accountability | 2:00pm IST daily | Overdue task follow-ups |
| Evening Check-in | 9:00pm IST daily | Daily wrap-up |
| Reminder Check | Every 30 min | Fire due reminders |
| Weekly Review | Sunday 8pm IST | Full week analysis |
| Self-Audit | Sunday 9pm IST | System prompt evolution |

## WhatsApp Import

```bash
cd backend
node src/scripts/importWhatsApp.js path/to/chat.txt
```

## Deployment

- **Backend** → [Railway](https://railway.app) (Node.js, always-on)
- **Frontend** → [Vercel](https://vercel.com) (Next.js)
- **Database** → [Supabase](https://supabase.com) (Postgres)
- **Cron** → GitHub Actions (calling Railway endpoints)
