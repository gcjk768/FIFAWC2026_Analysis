# FIFA World Cup 2026 — AI Match Predictor

AI-powered WC2026 assistant running locally on **qwen3.6:35b** via Ollama, with Telegram integration for alerts, predictions, live standings, news, and knockout bracket tracking.

---

## What It Does

- **Telegram Chatbot** — Ask anything about WC2026 in English or Chinese, get answers from a local AI
- **Automated Alerts** — Daily digest, pre-match previews (3-day + 1-day), result notifications — all bilingual (EN + ZH)
- **Auto News** — Fetches WC2026 top stories from FIFA's official website every 4 hours, vets by recency + relevance, posts to Telegram
- **Match Predictions** — Full AI analysis for all 72 group stage matches
- **Live Results** — 4-source waterfall (FIFA → ESPN → Sofascore → football-data.org) for live scores, HT scores, stats, and substitutions
- **Knockout Bracket** — Tracks Round of 32 through Final; auto-updates as results come in
- **Standings** — Real-time group standings computed from stored results
- **Obsidian Vault** — Full AI knowledge base: fixtures, standings, news, bracket, injuries, predictions, H2H — all auto-updated
- **Midnight Countdown** — Daily 00:00 SGT message showing days to opening match + today's fixtures

---

## Stack

| Layer | Technology |
|---|---|
| AI Model | qwen3.6:35b via Ollama (local, no API cost) |
| Backend | Node.js + Express (CommonJS) |
| Messaging | Telegram Bot API (long polling) |
| Knowledge Base | Obsidian vault (markdown files) |
| Scheduler | node-cron (Asia/Singapore timezone) |
| Results — Primary | FIFA.com API (no key required) |
| Results — Stats | ESPN unofficial API (no key required) |
| Results — Fallback | Sofascore unofficial API (no key required) |
| Results — Last Resort | football-data.org (free tier, requires key) |
| News Source | FIFA CMS "Top Stories" (no key required) |
| Storage | JSON files with atomic writes |

---

## Project Structure

```
├── server.js                      # Express API — matches, teams, predictions, analysis
├── chatbot.js                     # Telegram long-poll bot — receives & routes messages
├── scheduler.js                   # Cron jobs — digest, alerts, result polling, news
├── services/
│   ├── chatService.js             # Ollama queue, cache, rate limiting, history
│   ├── intentService.js           # Message routing — classifies intent, calls handlers
│   ├── qwenPersonality.js         # Master system prompt + bilingual templates
│   ├── squadsData.js              # Squad data for 16 major teams (instant responses)
│   ├── alertService.js            # Alert state tracking, bilingual Telegram message builders
│   ├── countdownService.js        # Countdown logic, fixture helpers
│   ├── newsService.js             # FIFA news fetch, scoring, dedup, Obsidian write
│   ├── resultsService.js          # 4-source match result waterfall + Obsidian write
│   ├── knockoutService.js         # Knockout bracket state + polling
│   ├── liveDataService.js         # Live standings computation + Obsidian sync
│   └── queryHandlers/
│       ├── matchHandler.js        # /today, /tomorrow, match times, results
│       ├── playerHandler.js       # /squad, /player, /injury, /lineup, /compare
│       ├── predictionHandler.js   # /predict, tournament winner, group predictions
│       ├── standingsHandler.js    # /group, /standings, /topscorers, /stats
│       ├── teamHandler.js         # Team info, team comparison
│       ├── knockoutHandler.js     # /bracket, /round, knockout stage queries
│       └── generalHandler.js      # Qwen fallback for any question
├── mcp-servers/
│   ├── obsidian-mcp/              # Local HTTP server — read/write Obsidian vault (port 3002)
│   └── telegram-mcp/             # Local HTTP sender — Telegram send helper (port 3003)
├── vault/
│   └── WC2026/                    # Obsidian notes — auto-updated by scheduler
├── data/
│   ├── predictions.json           # Saved AI predictions (atomic writes)
│   ├── match-results.json         # Group stage match results
│   ├── knockout.json              # Knockout bracket state (Round of 32 → Final)
│   ├── sent-alerts.json           # Tracks which alerts have been sent (7-day auto-prune)
│   ├── sent-news.json             # Tracks which news articles have been posted (7-day auto-prune)
│   ├── calendar-events.json       # Google Calendar event IDs
│   └── chat-history.json          # Per-chat conversation history (last 50 msgs)
└── .env                           # Environment variables (never commit this)
```

---

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Ollama](https://ollama.ai/) with `qwen3.6:35b` pulled

```bash
ollama pull qwen3.6:35b
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
OLLAMA_MODEL=qwen3.6:35b

TELEGRAM_BOT_TOKEN=        # from @BotFather
TELEGRAM_CHAT_ID=          # your personal Telegram user ID
TELEGRAM_CHANNEL_ID=       # -100XXXXXXXXXX (supergroup ID)
TELEGRAM_TOPIC_ID=         # topic/thread ID inside the group

DIGEST_TIME_SGT=08:00      # daily digest time (SGT)

OBSIDIAN_VAULT_PATH=       # leave blank to use built-in vault/ directory
OBSIDIAN_WC_FOLDER=WC2026

FOOTBALL_API_KEY=          # optional — football-data.org free tier (last-resort fallback only)
NEWS_API_KEY=              # optional — newsapi.org (FIFA feed is used first without any key)
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
| `/bracket` | Full knockout bracket |
| `/round` | Current knockout round results |
| `/topscorers` | Golden Boot leaderboard |
| `/stats` | Tournament stats |
| `/nextmatch` | Upcoming fixtures |
| `/result Brazil` | Latest result |
| `/ask [question]` | Ask qwen anything |
| `/help` | Full command list |

You can also type naturally — "Argentina squad", "who will win the World Cup?", "today's matches" — the bot understands plain English and Chinese.

---

## Automated Messages

All automated messages are **bilingual (English + Chinese)**. Sent to your Telegram topic without any user input:

| Trigger | Message |
|---|---|
| **00:00 SGT daily** | Countdown to opening match + today's fixtures \| 揭幕战倒计时 + 今日赛程 |
| **08:00 SGT daily** | Full daily digest — matches, news, injuries \| 每日简报 |
| **Every 4 hours** | Top WC2026 news from FIFA + major outlets \| 最新足球新闻 |
| **3 days before each match** | Pre-match preview with AI prediction \| 赛前3天预览 |
| **1 day before each match** | Final preview with team news \| 明天比赛最终预测 |
| **During matches (every 5 min)** | Result alert when final score is available \| 比赛结束 |
| **After knockout results** | Bracket update with next round fixtures \| 晋级情况 |

---

## Match Results & Live Data

Results are pulled from four sources in priority order — **no API key required for the first three**:

1. **FIFA.com API** — primary source; official data from the same API the FIFA website uses. Provides scores, HT score, goalscorers, cards, and substitutions with FIFA event type codes. Season ID `285023` for WC2026 discovered via live browser network inspection.
2. **ESPN unofficial API** — fetches match stats (possession, shots, passes, corners, fouls, saves) to augment FIFA data. No key required.
3. **Sofascore unofficial API** — full fallback if FIFA is unavailable; provides scores, events, and stats. No key required.
4. **football-data.org** — last resort only; requires `FOOTBALL_API_KEY` (free tier, 10 calls/min).

The scheduler polls every 5 minutes during active match windows. Final scores are written to:
- `data/match-results.json` (group stage)
- `data/knockout.json` (knockout rounds)
- `vault/WC2026/` (Obsidian notes for live standings and bracket)

---

## News System

WC2026 news is fetched automatically every 4 hours from FIFA's "Top Stories" CMS — no API key required. Articles are scored by:

- **Recency** — score decays linearly over 48 hours; articles older than 48h are dropped
- **Source tier** — BBC Sport, ESPN, The Athletic, Reuters score higher than tabloids
- **FIFA.com bonus** — FIFA's own editorial content gets a relevance boost
- **WC2026 keywords** — articles mentioning `world cup`, `2026`, `group stage`, `squad`, etc. score higher

The top 3 new (unsent) articles per cycle are posted to Telegram. All top 8 articles are written to `vault/WC2026/news.md` for Qwen to read. Article IDs are stored in `data/sent-news.json` (7-day auto-pruning) to prevent reposts.

---

## Knockout Bracket

The bracket is stored in `data/knockout.json` and tracks all stages:

| Round | Dates |
|---|---|
| Round of 32 | Jun 28 – Jul 1 |
| Round of 16 | Jul 3–5 |
| Quarter-Finals | Jul 8–9 |
| Semi-Finals | Jul 13–14 |
| 3rd Place Play-off | Jul 18 |
| Final | Jul 19 |

Use `/bracket` in Telegram to view the full bracket, or `/round` for the current active round.

---

## Obsidian Vault

The built-in vault lives at `vault/WC2026/`. The scheduler automatically keeps these files up to date so Qwen always has current context:

| File | Updated by | Contents |
|---|---|---|
| `teams/{team-name}.md` | Manual / pre-loaded | Squad, tactics, coach style |
| `injuries.md` | Manual | Injury tracker — referenced in previews and /injury |
| `head-to-head.md` | Manual | H2H records — used in pre-match analysis |
| `predictions/{matchId}.md` | After each AI analysis | Prediction result for that fixture |
| `live-standings.md` | After each group stage result | Group A–L standings table |
| `news.md` | Every 4 hours | Top 8 WC2026 news articles with summaries and URLs |
| `upcoming-fixtures.md` | On startup + daily | Next 30 fixtures with times and venues |
| `tournament-form.md` | After each result | Recent form (last 5) for every team that has played |
| `knockout-bracket.md` | After each knockout result | Full bracket from R32 to Final |
| `match-results/{matchId}.md` | After each result | Full result: score, HT, goals, cards, stats |

To use your own Obsidian vault instead of the built-in one, set `OBSIDIAN_VAULT_PATH` in `.env`.

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Service health check |
| GET | `/api/matches` | All 72 group stage fixtures (SGT) |
| GET | `/api/matches/:group` | Fixtures for a single group (a–l) |
| GET | `/api/teams` | All 48 team stats |
| GET | `/api/predictions` | All saved predictions |
| GET | `/api/predictions/:matchId` | Single prediction |
| POST | `/api/analyze/:matchId` | Run AI analysis for a match |
| GET | `/api/results` | All stored group stage results |
| GET | `/api/countdown` | Time to opening match |
| GET | `/api/summary` | Group winners + total goals |
| GET | `/api/export/csv` | Download predictions as CSV |
| POST | `/api/calendar/create-all` | Create Google Calendar events for all 72 matches |
| POST | `/api/calendar/create/:matchId` | Create calendar event for one match |
| GET | `/api/obsidian/notes` | List all WC vault notes |
| GET | `/api/obsidian/note/:filename` | Read a specific vault note |

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
- Rate limit: **10 Qwen questions per user per 5 minutes**
- All automated Telegram messages are **fully bilingual** (English + Chinese)
- Interactive Qwen responses are in **English + Chinese** by default
- The model is kept **warm in memory** (`keep_alive: 10m`) between requests
- Team name normalisation handles API variants (e.g. `Türkiye`, `Ivory Coast`, `USA`, `United States`)
- FIFA API endpoint and WC2026 season ID (`285023`) discovered via live browser network inspection on 2026-05-24
