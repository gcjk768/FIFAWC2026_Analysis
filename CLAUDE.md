# WC2026 Match Predictor — Claude Code Instructions

## Project Overview
FIFA World Cup 2026 Match Analysis Dashboard with:
- Local AI analysis via Ollama qwen3.5:35b
- Obsidian vault integration (read team notes, write predictions)
- Telegram alerts after every analysis
- Google Calendar events for all matches in SGT (UTC+8)
- Backend: Node.js + Express (CommonJS, no TypeScript)
- Frontend: Single public/index.html (vanilla JS, no framework, no build)
- Storage: data/predictions.json — ALWAYS atomic writes (write .tmp → rename)

## OLLAMA MODEL
- Model: qwen3.5:35b (hardcoded — do not auto-detect, do not change)
- Host: process.env.OLLAMA_HOST (default: http://localhost:11434)
- All calls: POST /api/generate with stream: false
- Prepend /no_think to every prompt (disables CoT, returns faster JSON)
- If Ollama is offline: show red banner in UI, do not crash server

## ENVIRONMENT VARIABLES (.env)
PORT=3001
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3.5:35b

TELEGRAM_BOT_TOKEN=         # from @BotFather
TELEGRAM_CHAT_ID=           # your personal chat ID with the bot
TELEGRAM_CHANNEL_ID=        # @yourchannel or -100xxxx (primary broadcast)
DIGEST_TIME_SGT=08:00       # daily digest time in SGT

OBSIDIAN_VAULT_PATH=        # leave blank to use built-in vault/ dir; or set to external Obsidian path
OBSIDIAN_WC_FOLDER=WC2026   # subfolder inside vault for WC notes

FOOTBALL_API_KEY=           # optional — football-data.org free tier
GOOGLE_CALENDAR_ID=primary  # or specific calendar ID

## ATOMIC FILE WRITES — NON-NEGOTIABLE
NEVER write directly to any .json file.
Always: write to file.json.tmp → fs.renameSync('file.json.tmp', 'file.json')
This applies to: predictions.json, calendar-events.json, any new data files.

## MCP SERVERS (both run locally as separate Node processes)

### Obsidian MCP — mcp-servers/obsidian-mcp/index.js — port 3002
Tools it must expose:
- obsidian_list_notes(folder?)      → list all .md files in vault (or subfolder)
- obsidian_read_note(filename)      → read full content of a note
- obsidian_write_note(filename, content) → create or overwrite a note (atomic)
- obsidian_search_notes(query)      → search note content for keyword
- obsidian_append_note(filename, content) → append text to existing note

Vault root = process.env.OBSIDIAN_VAULT_PATH || path.join(__dirname, '../../vault')
WC subfolder = path.join(VAULT_PATH, process.env.OBSIDIAN_WC_FOLDER)
Default built-in vault: vault/ directory inside the project root (always works, no setup needed)
External vault: set OBSIDIAN_VAULT_PATH to override with your Obsidian installation
Auto-create WC subfolder if it doesn't exist.
All file ops are scoped to the vault root — never write outside it.
Use atomic writes for obsidian_write_note (write .tmp → rename).

### Telegram MCP — mcp-servers/telegram-mcp/index.js — port 3003
Tools it must expose:
- telegram_send(message, parse_mode?)  → send text message (MarkdownV2 default)
- telegram_send_analysis(prediction)   → format + send a full match analysis
- telegram_send_digest(matches)        → send daily match digest

telegram_send_analysis must format the prediction object like this:
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

_Powered by qwen3.5:35b via Ollama_
```
Escape all special chars for Telegram MarkdownV2: . ! ( ) - = # + { }

## API ROUTES (server.js)
| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/health | Ollama status, MCP server status, env check |
| GET | /api/teams | All 48 team stats |
| GET | /api/matches | All 72 group stage fixtures (SGT times) |
| GET | /api/matches/:group | Fixtures for group a–l |
| POST | /api/analyze/:matchId | Full pipeline: Obsidian read → Ollama → save → Telegram → return |
| PATCH | /api/predictions/:matchId/suppress | Toggle suppress flag |
| POST | /api/predictions/:matchId/publish | Manual publish to Telegram channel |
| GET | /api/predictions | All saved predictions |
| GET | /api/predictions/:matchId | Single prediction |
| DELETE | /api/predictions | Clear all (with ?confirm=yes guard) |
| GET | /api/export/csv | Download CSV |
| GET | /api/summary | Group winners + total goals |
| POST | /api/calendar/create-all | Create Google Calendar events for all 72 matches |
| POST | /api/calendar/create/:matchId | Create calendar event for one match |
| GET | /api/obsidian/notes | List all WC vault notes |
| GET | /api/obsidian/note/:filename | Read a specific vault note |

## ANALYZE PIPELINE (POST /api/analyze/:matchId) — exact order
1. Load team stats for both teams from TEAM_STATS constant
2. Call Obsidian MCP: obsidian_search_notes(team1) + obsidian_search_notes(team2)
   → attach any found note content as CONTEXT block in Ollama prompt
3. Call Obsidian MCP: obsidian_read_note('head-to-head.md') if it exists
   → attach H2H section for this matchup if found
4. Build full Ollama prompt (see buildOllamaPrompt below)
5. POST to Ollama → parse JSON response → retry once on invalid JSON
6. Atomic write to data/predictions.json
7. If suppress !== true: call Telegram MCP: telegram_send_analysis(prediction) — fire and forget
8. Call Obsidian MCP: obsidian_write_note('predictions/{matchId}.md', formatted result) — fire and forget
9. Return prediction JSON to client

## OLLAMA PROMPT TEMPLATE
```js
const buildOllamaPrompt = (team1, team2, group, s1, s2, obsidianContext = '') => `/no_think
You are an expert football analyst for FIFA World Cup 2026.

MATCH: ${team1} vs ${team2}
GROUP: ${group}
STAGE: Group Stage (draws are valid — no extra time)

${team1}:
- FIFA Ranking: #${s1.rank}
- Avg Goals Scored/Game: ${s1.goalsFor}
- Avg Goals Conceded/Game: ${s1.goalsAgainst}
- Recent Form (last 5, newest first): ${s1.form}

${team2}:
- FIFA Ranking: #${s2.rank}
- Avg Goals Scored/Game: ${s2.goalsFor}
- Avg Goals Conceded/Game: ${s2.goalsAgainst}
- Recent Form (last 5, newest first): ${s2.form}
${obsidianContext ? '\nADDITIONAL CONTEXT FROM NOTES:\n' + obsidianContext : ''}
INSTRUCTIONS:
- Compare offensive vs defensive strength of both teams
- Factor in ranking gap and form trajectory
- Group stage context: teams may play cautiously, draws are valid
- Give a realistic scoreline reflecting each team's style (not just 1-0)
- Confidence: 50 = coin flip, 95 = near certainty

Respond ONLY with valid JSON, no markdown, no explanation:
{"winner":"${team1}|${team2}|draw","confidence":75,"predicted_score":"2-1","key_factors":["factor1","factor2","factor3"],"analysis_summary":"2-3 sentence tactical breakdown.","risk_factor":"low|medium|high"}`;
```

## CALENDAR EVENTS — SGT (UTC+8)
All match times are stored in SGT (Singapore Time, UTC+8).
When creating Google Calendar events:
- Title: "⚽ WC2026: {team1} vs {team2} | Group {group}"
- Description: Include predicted score + analysis if already analyzed, else just teams/venue
- Timezone: Asia/Singapore
- Duration: 2 hours
- Color: Green (Sage = 10) for analyzed matches, default for unanalyzed
- Reminder: 30 minutes before kickoff

## MATCH SCHEDULE — SGT CONVERSION
All original times are ET (UTC-4 during summer). SGT = ET + 12 hours.
Key conversion examples:
- 1pm ET  = 1am SGT next day
- 4pm ET  = 4am SGT next day
- 7pm ET  = 7am SGT next day
- 9pm ET  = 9am SGT next day
- 12am ET = 12pm SGT same day
Apply this offset to ALL 72 fixtures when storing/displaying match times.

## OBSIDIAN NOTE FORMATS

### Team Note (pre-existing, qwen reads for context)
File: WC2026/teams/{team-name}.md

### Prediction Note (auto-written after analysis)
File: WC2026/predictions/{matchId}.md

### Head-to-Head Note (create manually, qwen reads it)
File: WC2026/head-to-head.md

## FRONTEND DESIGN (public/index.html)
Dark football theme — single file, vanilla JS, no build step.

CSS vars:
  --bg: #0a0f1e | --card: #111827 | --card-hover: #1a2335
  --green: #22c55e | --gold: #f59e0b | --red: #ef4444
  --text: #f1f5f9 | --muted: #64748b | --border: #1e293b

Fonts (Google Fonts): 'Bebas Neue' headings, 'DM Sans' body

Tabs: Dashboard | Groups A-L | Calendar | Obsidian | Settings

## CODE STYLE
- async/await everywhere — no raw Promise chains
- All logs prefixed: [WC2026], [OBSIDIAN], [TELEGRAM], [CALENDAR]
- try/catch every async block — never crash on Telegram/Obsidian failure
- MCP calls are fire-and-forget where noted — don't block analysis on them
- Dates: ISO 8601 stored, SGT displayed (always show SGT label)
- JSDoc on every function

## MCP STARTUP
Both MCP servers start automatically when npm start runs via concurrently.
Server health-checks both before serving traffic (1s wait).
If an MCP server fails to start, log a warning but continue — don't block startup.

## SLASH COMMANDS
- /project:analyze-group <letter> — analyze all 6 matches in a group
- /project:analyze-all — analyze all 72 matches (skip already-done)
- /project:notify-today — send Telegram with today's SGT match schedule
- /project:sync-obsidian — write all existing predictions to Obsidian vault
- /project:reset-predictions — clear predictions.json (asks for confirmation)
