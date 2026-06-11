# WC2026 AI Match Predictor — Design Spec
<!-- last-updated: 2026-05-23 -->

## Status
Approved — ready for implementation

---

## Overview

A FIFA World Cup 2026 match analysis dashboard powered by local AI (Ollama `qwen3.6:35b`),
with Telegram as the primary broadcast channel and a web dashboard as the control panel.

**Core loop:** User triggers analysis → Ollama generates prediction → auto-posts to Telegram
channel → writes to Obsidian vault → saves to local JSON.

---

## Architecture

Three Node.js processes started together via `concurrently`:

| Process | Port | Role |
|---|---|---|
| `server.js` | 3001 | Main Express API, analyze pipeline, cron scheduler |
| `mcp-servers/obsidian-mcp/index.js` | 3002 | Read/write Obsidian vault notes |
| `mcp-servers/telegram-mcp/index.js` | 3003 | Send messages to Telegram channel |

All three start via `npm start`. If an MCP server fails to start, log a warning and continue — never block startup.

---

## Tech Stack

- **Runtime:** Node.js (CommonJS, no TypeScript)
- **Framework:** Express
- **AI:** Ollama `qwen3.6:35b` via `POST /api/generate` (stream: false)
- **Frontend:** Single `public/index.html` — vanilla JS, no framework, no build step
- **Scheduler:** `node-cron` for daily Telegram digest
- **Storage:** `data/predictions.json`, `data/calendar-events.json` — atomic writes only
- **Process manager:** `concurrently`

---

## Environment Variables (.env)

```
PORT=3001
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3.6:35b

TELEGRAM_BOT_TOKEN=        # from @BotFather — ACTIVE
TELEGRAM_CHAT_ID=          # personal chat ID (optional, for DMs)
TELEGRAM_CHANNEL_ID=       # @yourchannel or -100xxxx (primary broadcast)
DIGEST_TIME_SGT=08:00      # daily digest time in SGT

OBSIDIAN_VAULT_PATH=       # absolute path to vault folder
OBSIDIAN_WC_FOLDER=WC2026  # subfolder inside vault

FOOTBALL_API_KEY=          # optional — football-data.org free tier
GOOGLE_CALENDAR_ID=primary
```

---

## File Structure

```
wc2026-predictor/
├── CLAUDE.md
├── .claude/
│   ├── settings.json
│   └── commands/
│       ├── analyze-group.md
│       ├── analyze-all.md
│       ├── notify-today.md
│       ├── sync-obsidian.md
│       └── reset-predictions.md
├── mcp-servers/
│   ├── obsidian-mcp/
│   │   ├── index.js
│   │   └── package.json
│   └── telegram-mcp/
│       ├── index.js
│       └── package.json
├── server.js
├── package.json
├── .env
├── .env.example
├── data/
│   ├── predictions.json
│   └── calendar-events.json
├── public/
│   └── index.html
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-23-wc2026-predictor-design.md
```

---

## Atomic File Writes — Non-Negotiable

Every JSON write uses: `write to file.json.tmp` → `fs.renameSync('file.json.tmp', 'file.json')`.
Applies to: `predictions.json`, `calendar-events.json`, any future data files.
Never write directly to a `.json` file.

---

## Ollama Integration

- Model: `qwen3.6:35b` (hardcoded — do not auto-detect)
- Host: `process.env.OLLAMA_HOST` (default: `http://localhost:11434`)
- All calls: `POST /api/generate` with `stream: false`
- Prepend `/no_think` to every prompt (disables CoT, returns faster JSON)
- If Ollama offline: show red banner in dashboard, do not crash server
- Retry once on invalid JSON response before returning error

---

## Analyze Pipeline — POST /api/analyze/:matchId

Exact execution order:

1. Load team stats for both teams from `TEAM_STATS` constant
2. Call Obsidian MCP: `obsidian_search_notes(team1)` + `obsidian_search_notes(team2)`
   — attach found content as `CONTEXT` block in prompt
3. Call Obsidian MCP: `obsidian_read_note('head-to-head.md')` if it exists
   — attach H2H section for this matchup if found
4. Build enriched Ollama prompt via `buildOllamaPrompt()`
5. POST to Ollama → parse JSON → retry once on invalid JSON
6. Atomic write to `data/predictions.json`
7. If `suppress !== true`: call Telegram MCP `telegram_send_analysis(prediction)` — fire and forget
8. Call Obsidian MCP: `obsidian_write_note('predictions/{matchId}.md', formatted result)` — fire and forget
9. Return prediction JSON to client

---

## Telegram Integration (Primary Output)

### Three output types

| Type | Trigger | Target |
|---|---|---|
| Match analysis card | Auto after every analysis (unless suppressed) | Channel |
| Daily digest | `node-cron` job at `DIGEST_TIME_SGT` | Channel |
| Manual broadcast | "Publish to Channel" button on dashboard | Channel |

### Prediction fields tracking Telegram state

```json
{
  "telegramPosted": true,
  "suppress": false
}
```

### Analysis card format (MarkdownV2)

```
⚽ *WC2026 MATCH ANALYSIS*

🏟 *{team1} vs {team2}*
📅 {date_sgt} SGT | Group {group}

🏆 *Predicted Winner:* {winner}
📊 *Score:* {predicted_score}
📈 *Confidence:* {confidence}%
⚠️ *Risk:* {risk_factor}

🔑 *Key Factors:*
• {key_factors[0]}
• {key_factors[1]}
• {key_factors[2]}

📝 {analysis_summary}

_Powered by qwen3\.5:35b via Ollama_
```

All MarkdownV2 special chars escaped: `. ! ( ) - = # + { } [ ] |`

### Daily digest format

```
📅 *WC2026 Matches Today — {date} SGT*

⚽ {time} SGT — *{team1}* vs *{team2}* | Group {group}
   🏟 {venue}
   [If analyzed: 🏆 {winner} {score} ({confidence}%)]

[... repeated per match ...]

_All times Singapore Time \(SGT\)_
```

Skips matches where `suppress: true`.

---

## Obsidian MCP Server — port 3002

Endpoints:

| Method | Path | Tool |
|---|---|---|
| GET | `/list` | `obsidian_list_notes(folder?)` |
| GET | `/read/:filename` | `obsidian_read_note(filename)` |
| POST | `/write` | `obsidian_write_note(filename, content)` — atomic |
| GET | `/search` | `obsidian_search_notes(query)` |
| POST | `/append` | `obsidian_append_note(filename, content)` |

- Vault root = `process.env.OBSIDIAN_VAULT_PATH`
- WC subfolder = `path.join(VAULT_PATH, process.env.OBSIDIAN_WC_FOLDER)`
- Auto-create WC subfolder if missing
- All file ops scoped to vault root — path traversal protection required
- Atomic writes for `obsidian_write_note`

---

## Telegram MCP Server — port 3003

Endpoints:

| Method | Path | Description |
|---|---|---|
| POST | `/send` | `telegram_send(message, parse_mode?)` |
| POST | `/send-analysis` | `telegram_send_analysis(prediction)` |
| POST | `/send-digest` | `telegram_send_digest(matches)` |

- Default `parse_mode`: MarkdownV2
- Posts to `TELEGRAM_CHANNEL_ID` by default
- Never throws — all Telegram errors logged, not propagated

---

## API Routes — server.js

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Ollama status, MCP status, env check |
| GET | `/api/teams` | All 48 team stats |
| GET | `/api/matches` | All 72 group stage fixtures (SGT) |
| GET | `/api/matches/:group` | Fixtures for group a–l |
| POST | `/api/analyze/:matchId` | Full pipeline |
| PATCH | `/api/predictions/:matchId/suppress` | Toggle suppress flag |
| POST | `/api/predictions/:matchId/publish` | Manual publish to Telegram channel |
| GET | `/api/predictions` | All saved predictions |
| GET | `/api/predictions/:matchId` | Single prediction |
| DELETE | `/api/predictions` | Clear all (`?confirm=yes` guard) |
| GET | `/api/export/csv` | Download CSV |
| GET | `/api/summary` | Group winners + total goals |
| POST | `/api/calendar/create-all` | Create Google Calendar events for all 72 |
| POST | `/api/calendar/create/:matchId` | Create event for one match |
| GET | `/api/obsidian/notes` | List all WC vault notes |
| GET | `/api/obsidian/note/:filename` | Read a specific vault note |

---

## Frontend — public/index.html

Dark football theme, single file, vanilla JS, no build step.

**CSS variables:**
```css
--bg: #0a0f1e
--card: #111827
--card-hover: #1a2335
--green: #22c55e
--gold: #f59e0b
--red: #ef4444
--text: #f1f5f9
--muted: #64748b
--border: #1e293b
```

**Fonts:** `Bebas Neue` (headings), `DM Sans` (body) via Google Fonts

**Tabs:** Dashboard · Groups A–L · Calendar · Obsidian · Settings

### Dashboard tab
- Stats bar: `X/72 analyzed` | `X posted to channel` | `X Obsidian notes` | Ollama status pill
- "Analyze Today's Matches" quick action button
- Today's matches (filtered by SGT date)
- Recent predictions feed (last 5)

### Groups A–L tab
- Group selector (A–L buttons)
- 2-column match card grid
- Each card: flag emoji + team names, SGT date/time, venue, Analyze button
- Result panel: winner badge, big score, confidence bar, 3 factor pills, analysis text
- Per-card controls: 📢 Publish button · 🔇 Suppress toggle · 📓 Obsidian indicator
- ⚽ spinning loader while Ollama runs

### Calendar tab
- All 72 matches grouped by SGT date
- "Add to Google Calendar" per match
- "Add ALL to Google Calendar" bulk button
- ✅ if event already created

### Obsidian tab
- List all notes in WC2026 vault folder
- Click to read note inline
- Refresh button + last-modified timestamp

### Settings tab
- Display `.env` config (mask tokens — show last 4 chars only)
- Test buttons: "Test Telegram" · "Test Obsidian" · "Test Ollama"
- Digest time configuration (reads/writes `DIGEST_TIME_SGT`)

---

## Match Data

### GROUPS constant (12 groups, 4 teams each)
```
A: Mexico, South Africa, South Korea, Czechia
B: Canada, Bosnia and Herzegovina, Qatar, Switzerland
C: Brazil, Morocco, Haiti, Scotland
D: USA, Paraguay, Australia, Turkiye
E: Germany, Curacao, Ivory Coast, Ecuador
F: Netherlands, Japan, Sweden, Tunisia
G: Belgium, Egypt, Iran, New Zealand
H: Spain, Cape Verde, Saudi Arabia, Uruguay
I: France, Senegal, Iraq, Norway
J: Argentina, Algeria, Austria, Jordan
K: Portugal, DR Congo, Uzbekistan, Colombia
L: England, Croatia, Ghana, Panama
```

### 72 fixtures
Generated round-robin (6 matches per group).
`matchId` format: `{GROUP}-{team1-slug}-vs-{team2-slug}` (e.g., `C-brazil-vs-morocco`)
All times stored in SGT (ISO 8601). ET → SGT = ET + 12 hours.
Tournament: Jun 12 SGT → Jun 28 SGT.

### 48 teams with FIFA stats
All defined in `TEAM_STATS` constant in `server.js` (rank, goalsFor, goalsAgainst, form).

---

## Scheduler (node-cron)

- Runs inside `server.js`
- Cron expression derived from `DIGEST_TIME_SGT` (e.g., `08:00` → `0 8 * * *`)
- Timezone: `Asia/Singapore`
- On fire: fetches today's SGT matches, attaches any existing predictions, posts digest to channel
- Skips suppressed matches

---

## Google Calendar Integration

- Uses connected Google Calendar MCP
- Title: `⚽ WC2026: {team1} vs {team2} | Group {group}`
- Timezone: `Asia/Singapore`
- Duration: 2 hours
- Reminder: 30 min before
- Color: Green (Sage = 10) if analyzed, default if not
- Event IDs stored in `data/calendar-events.json` (atomic write)
- Skip if event ID already exists

---

## Code Style

- `async/await` everywhere — no raw Promise chains
- Logs prefixed: `[WC2026]`, `[OBSIDIAN]`, `[TELEGRAM]`, `[CALENDAR]`
- `try/catch` every async block — Telegram/Obsidian failures logged, never thrown
- Fire-and-forget where noted (Telegram, Obsidian writes)
- JSDoc on every function
- No hardcoded secrets — all from `process.env`

---

## Slash Commands (.claude/commands/)

| Command | Description |
|---|---|
| `/project:analyze-group <letter>` | Analyze all 6 matches in a group |
| `/project:analyze-all` | Analyze all 72 matches (skip done) |
| `/project:notify-today` | Post today's matches to Telegram |
| `/project:sync-obsidian` | Write all predictions to Obsidian |
| `/project:reset-predictions` | Clear predictions (with confirmation) |

---

## Verification Steps (post-build)

1. `npm run check` — syntax check all three JS files
2. `npm start` — all three processes start
3. `curl http://localhost:3001/api/health` — green across the board
4. `curl http://localhost:3002/list` — empty array (vault empty is fine)
5. `curl -X POST http://localhost:3003/send -d '{"message":"test"}'` — message appears in channel
6. `curl -X POST http://localhost:3001/api/analyze/C-brazil-vs-morocco` — full pipeline fires
7. Check Telegram channel for Brazil vs Morocco card
8. Check Obsidian vault for `WC2026/predictions/C-brazil-vs-morocco.md`
