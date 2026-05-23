# FIFA World Cup 2026 — AI Match Predictor

AI-powered WC2026 assistant running locally on **qwen3.5:35b** via Ollama, with Telegram integration for alerts, predictions, and live Q&A.

---

## What It Does

- **Telegram Chatbot** — Ask anything about WC2026 in English or Chinese, get answers from a local AI
- **Automated Alerts** — Daily digest, pre-match previews (3-day + 1-day), and result notifications
- **Match Predictions** — Full AI analysis for all 72 group stage matches
- **Obsidian Vault** — Stores team notes, predictions, injuries, and H2H records
- **Midnight Countdown** — Daily 00:00 SGT message showing days to opening match + today's fixtures

---

## Stack

| Layer | Technology |
|---|---|
| AI Model | qwen3.5:35b via Ollama (local, no API cost) |
| Backend | Node.js + Express (CommonJS) |
| Messaging | Telegram Bot API (long polling) |
| Knowledge Base | Obsidian vault (markdown files) |
| Scheduler | node-cron (Asia/Singapore timezone) |
| Storage | JSON files with atomic writes |

---

## Project Structure

```
├── server.js              # Express API — matches, teams, predictions, analysis
├── chatbot.js             # Telegram long-poll bot — receives & routes messages
├── scheduler.js           # Cron jobs — digest, alerts, result polling
├── services/
│   ├── chatService.js     # Ollama queue, cache, rate limiting, history
│   ├── intentService.js   # Message routing — classifies intent, calls handlers
│   ├── qwenPersonality.js # Master system prompt + bilingual templates
│   ├── squadsData.js      # Squad data for 16 major teams (instant responses)
│   ├── alertService.js    # Alert state tracking, Telegram send helpers
│   ├── countdownService.js# Countdown logic, fixture helpers
│   ├── newsService.js     # WC2026 news fetching
│   ├── resultsService.js  # Match result fetching + Obsidian write
│   └── queryHandlers/
│       ├── matchHandler.js      # /today, /tomorrow, match times, results
│       ├── playerHandler.js     # /squad, /player, /injury, /lineup, /compare
│       ├── predictionHandler.js # /predict, tournament winner, group predictions
│       ├── standingsHandler.js  # /group, /standings, /topscorers, /stats
│       ├── teamHandler.js       # Team info, team comparison
│       └── generalHandler.js   # Qwen fallback for any question
├── mcp-servers/
│   ├── obsidian-mcp/      # Local HTTP server — read/write Obsidian vault (port 3002)
│   └── telegram-mcp/      # Local HTTP sender — Telegram send helper (port 3003)
├── vault/
│   └── WC2026/            # Obsidian notes — teams, injuries, H2H, predictions
├── data/
│   ├── predictions.json   # Saved AI predictions (atomic writes)
│   ├── sent-alerts.json   # Tracks which alerts have been sent
│   ├── match-results.json # Match results
│   └── chat-history.json  # Per-chat conversation history (last 50 msgs)
└── .env                   # Environment variables (never commit this)
```

---

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Ollama](https://ollama.ai/) with `qwen3.5:35b` pulled

```bash
ollama pull qwen3.5:35b
```

### 1. Install dependencies

```bash
npm run install-all
```

### 2. Configure environment

Copy `.env` and fill in your values:

```env
PORT=3001
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3.5:35b

TELEGRAM_BOT_TOKEN=        # from @BotFather
TELEGRAM_CHAT_ID=          # your personal Telegram user ID
TELEGRAM_CHANNEL_ID=       # -100XXXXXXXXXX (supergroup ID)
TELEGRAM_TOPIC_ID=         # topic/thread ID inside the group

DIGEST_TIME_SGT=08:00      # daily digest time (SGT)

OBSIDIAN_VAULT_PATH=       # leave blank to use built-in vault/ directory
OBSIDIAN_WC_FOLDER=WC2026

FOOTBALL_API_KEY=          # optional — football-data.org free tier (for live results)
```

> **Getting your Telegram Channel ID:** Open `t.me/c/XXXXXXXXX/YYY` — the channel ID is `-100XXXXXXXXX` and the topic is `YYY`.

### 3. Add bot to your Telegram group

1. Add `@YourBotUsername` to your group as admin
2. Grant **Post Messages** permission
3. Note the topic ID from the group URL

### 4. Start

```bash
npm start        # starts all 5 processes together
npm run dev      # same but with --watch (auto-restart on file changes)
```

---

## Bot Commands

| Command | Description |
|---|---|
| `/squad Argentina` | Full squad with player stats (instant) |
| `/today` | Today's matches in SGT |
| `/tomorrow` | Tomorrow's matches |
| `/predict Brazil Morocco` | AI match prediction |
| `/player Mbappe` | Player profile |
| `/injury Germany` | Injury report |
| `/lineup France` | Expected starting XI |
| `/compare Mbappe Vinicius` | Side-by-side player comparison |
| `/group C` | Group C standings |
| `/standings` | All group standings |
| `/topscorers` | Golden Boot leaderboard |
| `/stats` | Tournament stats |
| `/nextmatch` | Upcoming fixtures |
| `/result Brazil` | Latest result |
| `/ask [question]` | Ask qwen anything |
| `/help` | Full command list |

You can also type naturally — "Argentina squad", "who will win the World Cup?", "today's matches" — the bot understands plain English and Chinese.

---

## Automated Messages

Messages sent automatically to your Telegram topic, no user input needed:

| Time | Message |
|---|---|
| **00:00 SGT daily** | Countdown to opening match + today's fixtures |
| **08:00 SGT daily** | Full daily digest — matches, news, injuries |
| **3 days before each match** | Pre-match preview with AI prediction |
| **1 day before each match** | Final preview with weather + team news |
| **During matches (every 5 min)** | Result alert when final score is available |

---

## Obsidian Vault

The built-in vault lives at `vault/WC2026/`. You can add notes to improve AI responses:

| File | Purpose |
|---|---|
| `teams/{team-name}.md` | Team notes — squad, tactics, coach style |
| `injuries.md` | Injury tracker — referenced in previews and /injury |
| `head-to-head.md` | H2H records — used in pre-match analysis |
| `predictions/{matchId}.md` | Auto-written after each AI analysis |

To use your own Obsidian vault instead of the built-in one, set `OBSIDIAN_VAULT_PATH` in `.env`.

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Service health check |
| GET | `/api/matches` | All 72 group stage fixtures (SGT) |
| GET | `/api/teams` | All 48 team stats |
| GET | `/api/predictions` | All saved predictions |
| POST | `/api/analyze/:matchId` | Run AI analysis for a match |
| GET | `/api/countdown` | Time to opening match |
| GET | `/api/results` | All stored match results |

---

## Slash Commands (Claude Code)

```
/project:analyze-group <A-L>   # analyze all 6 matches in a group
/project:analyze-all           # analyze all 72 matches
/project:notify-today          # send today's schedule to Telegram
/project:sync-obsidian         # write all predictions to vault
/project:reset-predictions     # clear predictions.json (with confirmation)
```

---

## Notes

- All file writes are **atomic** (write `.tmp` → rename) — no corrupt JSON on crash
- Qwen queries are **queued serially** — concurrent questions wait their turn
- Rate limit: **3 Qwen questions per user per 5 minutes**
- Responses are **bilingual** (English + Chinese) for all AI-generated answers
- The model is kept **warm in memory** (`keep_alive: 10m`) between requests
