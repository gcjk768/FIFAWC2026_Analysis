'use strict';

require('dotenv').config({ override: true });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3001;
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.6:35b';
const OBSIDIAN_MCP = 'http://localhost:3002';
const TELEGRAM_MCP = 'http://localhost:3003';
const DIGEST_TIME_SGT = process.env.DIGEST_TIME_SGT || '08:00';

const PREDICTIONS_FILE = path.join(__dirname, 'data', 'predictions.json');
const CALENDAR_FILE = path.join(__dirname, 'data', 'calendar-events.json');

// ─── GROUPS & TEAM STATS ───────────────────────────────────────────────────

const GROUPS = {
  A: { teams: ['Mexico', 'South Africa', 'South Korea', 'Czechia'] },
  B: { teams: ['Canada', 'Bosnia and Herzegovina', 'Qatar', 'Switzerland'] },
  C: { teams: ['Brazil', 'Morocco', 'Haiti', 'Scotland'] },
  D: { teams: ['USA', 'Paraguay', 'Australia', 'Turkiye'] },
  E: { teams: ['Germany', 'Curacao', 'Ivory Coast', 'Ecuador'] },
  F: { teams: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'] },
  G: { teams: ['Belgium', 'Egypt', 'Iran', 'New Zealand'] },
  H: { teams: ['Spain', 'Cape Verde', 'Saudi Arabia', 'Uruguay'] },
  I: { teams: ['France', 'Senegal', 'Iraq', 'Norway'] },
  J: { teams: ['Argentina', 'Algeria', 'Austria', 'Jordan'] },
  K: { teams: ['Portugal', 'DR Congo', 'Uzbekistan', 'Colombia'] },
  L: { teams: ['England', 'Croatia', 'Ghana', 'Panama'] },
};

const TEAM_STATS = {
  'Argentina':              { rank: 1,  goalsFor: 2.1, goalsAgainst: 0.8, form: 'WWWWW' },
  'France':                 { rank: 2,  goalsFor: 1.9, goalsAgainst: 0.9, form: 'WWWDW' },
  'Spain':                  { rank: 3,  goalsFor: 2.0, goalsAgainst: 0.7, form: 'WWWWW' },
  'England':                { rank: 4,  goalsFor: 1.8, goalsAgainst: 0.9, form: 'WDWWW' },
  'Brazil':                 { rank: 5,  goalsFor: 2.0, goalsAgainst: 1.0, form: 'WWDWW' },
  'Portugal':               { rank: 6,  goalsFor: 2.2, goalsAgainst: 1.0, form: 'WWWWW' },
  'Netherlands':            { rank: 7,  goalsFor: 1.9, goalsAgainst: 1.1, form: 'WWWDW' },
  'Colombia':               { rank: 9,  goalsFor: 1.7, goalsAgainst: 1.0, form: 'WDWWW' },
  'Croatia':                { rank: 10, goalsFor: 1.4, goalsAgainst: 1.0, form: 'WDWWL' },
  'Belgium':                { rank: 11, goalsFor: 1.8, goalsAgainst: 1.0, form: 'WWWDW' },
  'Germany':                { rank: 12, goalsFor: 2.1, goalsAgainst: 1.2, form: 'WWDWW' },
  'Morocco':                { rank: 13, goalsFor: 1.4, goalsAgainst: 0.8, form: 'WWWDW' },
  'Uruguay':                { rank: 14, goalsFor: 1.5, goalsAgainst: 0.9, form: 'WDWWW' },
  'Mexico':                 { rank: 15, goalsFor: 1.6, goalsAgainst: 1.2, form: 'WDWDW' },
  'USA':                    { rank: 16, goalsFor: 1.5, goalsAgainst: 1.2, form: 'WWDWD' },
  'Japan':                  { rank: 18, goalsFor: 1.6, goalsAgainst: 1.0, form: 'WWWDW' },
  'Switzerland':            { rank: 19, goalsFor: 1.5, goalsAgainst: 1.0, form: 'WWDWD' },
  'Senegal':                { rank: 20, goalsFor: 1.5, goalsAgainst: 1.1, form: 'WWDWW' },
  'South Korea':            { rank: 22, goalsFor: 1.5, goalsAgainst: 1.2, form: 'WWDWD' },
  'Australia':              { rank: 24, goalsFor: 1.3, goalsAgainst: 1.3, form: 'WDWDL' },
  'Sweden':                 { rank: 25, goalsFor: 1.5, goalsAgainst: 1.1, form: 'WWDDD' },
  'Norway':                 { rank: 26, goalsFor: 1.8, goalsAgainst: 1.3, form: 'WWWDD' },
  'Austria':                { rank: 27, goalsFor: 1.6, goalsAgainst: 1.2, form: 'WWWDL' },
  'Turkiye':                { rank: 28, goalsFor: 1.5, goalsAgainst: 1.3, form: 'WWDLD' },
  'Iran':                   { rank: 29, goalsFor: 1.2, goalsAgainst: 1.3, form: 'WDWLD' },
  'Ecuador':                { rank: 30, goalsFor: 1.4, goalsAgainst: 1.3, form: 'WDWWL' },
  'Scotland':               { rank: 32, goalsFor: 1.3, goalsAgainst: 1.3, form: 'WDWLL' },
  'Czechia':                { rank: 33, goalsFor: 1.4, goalsAgainst: 1.3, form: 'WWDDD' },
  'Tunisia':                { rank: 34, goalsFor: 1.2, goalsAgainst: 1.2, form: 'WDDDL' },
  'Egypt':                  { rank: 35, goalsFor: 1.3, goalsAgainst: 1.2, form: 'DDWWL' },
  'Qatar':                  { rank: 37, goalsFor: 1.1, goalsAgainst: 1.5, form: 'DDWLL' },
  'Ivory Coast':            { rank: 38, goalsFor: 1.4, goalsAgainst: 1.4, form: 'WDWDL' },
  'Algeria':                { rank: 40, goalsFor: 1.3, goalsAgainst: 1.3, form: 'WWDDD' },
  'Canada':                 { rank: 42, goalsFor: 1.4, goalsAgainst: 1.3, form: 'WDWDW' },
  'DR Congo':               { rank: 48, goalsFor: 1.2, goalsAgainst: 1.3, form: 'WWDLL' },
  'Paraguay':               { rank: 55, goalsFor: 1.2, goalsAgainst: 1.4, form: 'WWDDL' },
  'Saudi Arabia':           { rank: 57, goalsFor: 1.1, goalsAgainst: 1.5, form: 'WDDLL' },
  'Ghana':                  { rank: 60, goalsFor: 1.2, goalsAgainst: 1.4, form: 'WDDDL' },
  'Iraq':                   { rank: 63, goalsFor: 1.1, goalsAgainst: 1.4, form: 'WDDLL' },
  'South Africa':           { rank: 67, goalsFor: 1.0, goalsAgainst: 1.4, form: 'WDDLL' },
  'Uzbekistan':             { rank: 68, goalsFor: 1.1, goalsAgainst: 1.4, form: 'WDDLL' },
  'Panama':                 { rank: 70, goalsFor: 1.0, goalsAgainst: 1.5, form: 'WDDLL' },
  'Cape Verde':             { rank: 75, goalsFor: 1.1, goalsAgainst: 1.4, form: 'WDDLL' },
  'Curacao':                { rank: 79, goalsFor: 0.8, goalsAgainst: 1.8, form: 'DLLLL' },
  'Jordan':                 { rank: 85, goalsFor: 0.9, goalsAgainst: 1.5, form: 'DDDLL' },
  'Haiti':                  { rank: 85, goalsFor: 0.8, goalsAgainst: 1.7, form: 'LLDLL' },
  'New Zealand':            { rank: 95, goalsFor: 1.0, goalsAgainst: 1.6, form: 'DDDLL' },
  'Bosnia and Herzegovina': { rank: 65, goalsFor: 1.2, goalsAgainst: 1.4, form: 'WDDLL' },
};

// ─── VENUES ────────────────────────────────────────────────────────────────

const VENUES = [
  'MetLife Stadium, New York/New Jersey',
  'AT&T Stadium, Dallas',
  'SoFi Stadium, Los Angeles',
  "Levi's Stadium, San Francisco Bay Area",
  'Allegiant Stadium, Las Vegas',
  'State Farm Stadium, Glendale',
  'Arrowhead Stadium, Kansas City',
  'Empower Field, Denver',
  'NRG Stadium, Houston',
  'Hard Rock Stadium, Miami',
  'Lincoln Financial Field, Philadelphia',
  'Gillette Stadium, Boston',
  'BC Place, Vancouver',
  'Estadio Azteca, Mexico City',
  'Estadio Akron, Guadalajara',
  'BMO Field, Toronto',
];

// ─── FIXTURES GENERATION ───────────────────────────────────────────────────

/**
 * Slugify a team name for use in matchId.
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Generate ISO 8601 SGT date string for a given match.
 * Tournament: Jun 12 SGT → Jun 28 SGT (2026)
 * Matchday 1: Jun 12-15, Matchday 2: Jun 19-22, Matchday 3: Jun 25-27
 * @param {number} groupIndex - 0-based group index (A=0, B=1, ...)
 * @param {number} matchday - 1, 2, or 3
 * @param {number} matchIndex - 0-based index within matchday
 * @returns {string} ISO string in SGT timezone
 */
function generateMatchDateSgt(groupIndex, matchday, matchIndex) {
  // SGT dates for each matchday start
  const md1Start = new Date('2026-06-12T00:00:00+08:00');
  const md2Start = new Date('2026-06-19T00:00:00+08:00');
  const md3Start = new Date('2026-06-25T00:00:00+08:00');

  const starts = [md1Start, md2Start, md3Start];
  const base = new Date(starts[matchday - 1]);

  // Spread groups across 4 days per matchday
  const dayOffset = Math.floor((groupIndex * 2 + matchIndex) / 4);
  base.setDate(base.getDate() + dayOffset);

  // Kick-off times in SGT: 1am, 4am, 7am, 10am (these are evening ET times converted)
  const sgtHours = [1, 4, 7, 10];
  const slot = (groupIndex * 2 + matchIndex) % 4;
  base.setHours(sgtHours[slot], 0, 0, 0);

  return base.toISOString();
}

/**
 * Generate all 72 group stage fixtures.
 * @returns {object[]}
 */
function generateFixtures() {
  const fixtures = [];
  const groupLetters = Object.keys(GROUPS);

  groupLetters.forEach((letter, groupIndex) => {
    const teams = GROUPS[letter].teams;
    // Round-robin pairs: (0,1),(0,2),(0,3),(1,2),(1,3),(2,3)
    const pairs = [];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        pairs.push([teams[i], teams[j]]);
      }
    }
    // Assign matchdays: MD1=(0,1,2), MD2=(3), MD3=(4,5) — standard WC schedule
    const matchdayMap = [1, 1, 2, 1, 2, 3];
    const matchIndexMap = [0, 1, 0, 2, 1, 0];

    pairs.forEach(([team1, team2], pairIndex) => {
      const matchId = `${letter}-${slugify(team1)}-vs-${slugify(team2)}`;
      const matchday = matchdayMap[pairIndex] || 1;
      const matchIndex = matchIndexMap[pairIndex] || 0;
      const dateIso = generateMatchDateSgt(groupIndex, matchday, matchIndex);
      const venueIdx = (groupIndex * 6 + pairIndex) % VENUES.length;

      fixtures.push({
        matchId,
        group: letter,
        team1,
        team2,
        matchday,
        dateIso,
        dateSgt: formatSgt(dateIso),
        timeSgt: formatTimeSgt(dateIso),
        venue: VENUES[venueIdx],
      });
    });
  });

  return fixtures;
}

const FIXTURES = generateFixtures();

// ─── FIXTURE TIME SYNC FROM API ────────────────────────────────────────────

const FIXTURE_CACHE_FILE = path.join(__dirname, 'data', 'fixtures-api.json');

/** API team name → our canonical name */
const API_TEAM_NORM = {
  'bosnia-herzegovina': 'Bosnia and Herzegovina', 'united states': 'USA',
  'czech republic': 'Czechia', 'türkiye': 'Turkiye', 'turkey': 'Turkiye',
  "côte d'ivoire": 'Ivory Coast', 'democratic republic of the congo': 'DR Congo',
  'republic of korea': 'South Korea',
};
const normTeam = (n) => API_TEAM_NORM[(n || '').toLowerCase()] || n;

/**
 * Sync fixture kickoff times from football-data.org API.
 * Updates FIXTURES in-place so displayed times match the real schedule.
 * Caches results in data/fixtures-api.json (re-syncs once per day).
 */
async function syncFixturesFromApi() {
  const apiKey = process.env.FOOTBALL_API_KEY;

  // Always apply cache if it exists — API key only needed to refresh stale data
  try {
    if (fs.existsSync(FIXTURE_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(FIXTURE_CACHE_FILE, 'utf8'));
      const cacheAge = Date.now() - new Date(cached.syncedAt).getTime();
      if (cacheAge < 86400000) {
        applyApiTimes(cached.matches);
        console.log(`[WC2026] Fixture times loaded from cache (${cached.matches.length} matches)`);
        if (!apiKey) return;  // no key — can't refresh, but cache was applied
        return;               // cache fresh — no need to re-fetch
      }
    }
  } catch {}

  if (!apiKey) {
    console.warn('[WC2026] No FOOTBALL_API_KEY — fixture times may be approximate');
    return;
  }

  try {
    const resp = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': apiKey },
      timeout: 15000,
    });
    if (!resp.ok) { console.warn('[WC2026] Fixture sync failed:', resp.status); return; }
    const { matches } = await resp.json();
    if (!matches) return;

    // Save cache
    const tmp = FIXTURE_CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ syncedAt: new Date().toISOString(), matches }, null, 2));
    fs.renameSync(tmp, FIXTURE_CACHE_FILE);

    applyApiTimes(matches);
    console.log(`[WC2026] Fixture times synced from API (${matches.length} matches)`);
  } catch (err) {
    console.warn('[WC2026] Fixture sync error:', err.message);
  }
}

/**
 * Apply API match times to our FIXTURES array in-place.
 * @param {object[]} apiMatches
 */
function applyApiTimes(apiMatches) {
  for (const apiMatch of apiMatches) {
    if (!apiMatch.utcDate) continue;
    const home = normTeam(apiMatch.homeTeam?.name || '');
    const away = normTeam(apiMatch.awayTeam?.name || '');
    const fixture = FIXTURES.find((f) =>
      (f.team1 === home && f.team2 === away) ||
      (f.team1 === away && f.team2 === home)
    );
    if (!fixture) continue;
    const d = new Date(apiMatch.utcDate);
    fixture.dateIso = d.toISOString();
    fixture.dateSgt = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    fixture.timeSgt = d.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false });
    // Also store API match ID for precise result fetching later
    fixture.apiId = apiMatch.id;
  }
}

/**
 * Format ISO date to "DD Mon YYYY, HH:mm" SGT label.
 * @param {string} iso
 * @returns {string}
 */
function formatSgt(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) + ' SGT';
}

/**
 * Format ISO date to "HH:mm" only.
 * @param {string} iso
 * @returns {string}
 */
function formatTimeSgt(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Get today's date string in SGT (YYYY-MM-DD).
 * @returns {string}
 */
function todaySgt() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

// ─── ATOMIC FILE HELPERS ───────────────────────────────────────────────────

/**
 * Atomically read and parse a JSON file.
 * @param {string} filePath
 * @returns {object}
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Atomically write data to a JSON file (tmp → rename).
 * @param {string} filePath
 * @param {object} data
 */
function writeJson(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ─── MCP HELPERS ──────────────────────────────────────────────────────────

/**
 * Call Obsidian MCP with a GET request.
 * @param {string} endpoint
 * @returns {Promise<object>}
 */
async function obsidianGet(endpoint) {
  const resp = await fetch(`${OBSIDIAN_MCP}${endpoint}`, { timeout: 5000 });
  return resp.json();
}

/**
 * Call Obsidian MCP with a POST request.
 * @param {string} endpoint
 * @param {object} body
 * @returns {Promise<object>}
 */
async function obsidianPost(endpoint, body) {
  const resp = await fetch(`${OBSIDIAN_MCP}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 5000,
  });
  return resp.json();
}

/**
 * Call Telegram MCP with a POST request.
 * @param {string} endpoint
 * @param {object} body
 * @returns {Promise<object>}
 */
async function telegramPost(endpoint, body) {
  const resp = await fetch(`${TELEGRAM_MCP}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 10000,
  });
  return resp.json();
}

/**
 * Ping an HTTP URL and return true if reachable.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function pingUrl(url) {
  try {
    await fetch(url, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ─── OLLAMA HELPERS ────────────────────────────────────────────────────────

/**
 * Build the enriched Ollama prompt for a matchup.
 * @param {string} team1
 * @param {string} team2
 * @param {string} group
 * @param {object} s1 - Team 1 stats
 * @param {object} s2 - Team 2 stats
 * @param {string} obsidianContext - Additional context from Obsidian notes
 * @returns {string}
 */
function buildOllamaPrompt(team1, team2, group, s1, s2, obsidianContext = '') {
  return `/no_think
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
- score_reasoning: 1-2 sentences explaining WHY each team scores that many goals (specific attacking/defensive reasons)

Respond ONLY with valid JSON, no markdown, no explanation:
{"winner":"${team1}|${team2}|draw","confidence":75,"predicted_score":"2-1","score_reasoning":"1-2 sentences on why team1 scores X and team2 scores Y","key_factors":["factor1","factor2","factor3"],"analysis_summary":"2-3 sentence tactical breakdown.","risk_factor":"low|medium|high"}`;
}

/**
 * Run Ollama inference for a match.
 * Retries once on invalid JSON.
 * @param {string} prompt
 * @returns {Promise<object>}
 */
async function runOllama(prompt) {
  // think:false is required — qwen3.6 ignores the /no_think text directive via
  // /api/generate and burns minutes of hidden thinking tokens without it
  const body = { model: OLLAMA_MODEL, prompt, stream: false, think: false };

  const attempt = async () => {
    const resp = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 300000,
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = (data.response || '').trim();
    // Extract JSON object from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Ollama response');
    return JSON.parse(jsonMatch[0]);
  };

  try {
    return await attempt();
  } catch (err) {
    console.log('[WC2026] Ollama retry after error:', err.message);
    return attempt();
  }
}

/**
 * Translate prediction analysis fields to Simplified Chinese for the bilingual
 * Telegram card. Non-fatal — returns null on any failure so the card falls
 * back to English content.
 * @param {object} p - prediction with key_factors + analysis_summary
 * @returns {Promise<{key_factors_zh: string[], analysis_summary_zh: string}|null>}
 */
async function translateAnalysisToZh(p) {
  const factors = (p.key_factors || []).slice(0, 3);
  if (factors.length === 0 && !p.analysis_summary) return null;

  const prompt = `/no_think
Translate the following football match analysis into Simplified Chinese.
Keep player names in their commonly used Chinese forms (e.g. 三笘薰 for Mitoma) or original spelling if unsure. Keep team names, numbers and scorelines unchanged.

KEY FACTORS:
${factors.map((f, i) => `${i + 1}. ${f}`).join('\n')}

SUMMARY:
${p.analysis_summary || ''}

Respond ONLY with valid JSON, no markdown:
{"key_factors_zh":["译文1","译文2","译文3"],"analysis_summary_zh":"摘要译文"}`;

  try {
    const result = await runOllama(prompt);
    if (!Array.isArray(result.key_factors_zh) || !result.analysis_summary_zh) return null;
    return {
      key_factors_zh: result.key_factors_zh.slice(0, 3).map(String),
      analysis_summary_zh: String(result.analysis_summary_zh),
    };
  } catch (err) {
    console.error('[WC2026] ZH translation failed (non-fatal):', err.message);
    return null;
  }
}

// ─── OBSIDIAN CONTEXT BUILDER ──────────────────────────────────────────────

/**
 * Gather relevant Obsidian notes for both teams in a match.
 * Also fetches live weather for the venue/date if provided.
 * @param {string} team1
 * @param {string} team2
 * @param {string} [venue] - venue name matching VENUE_COORDS key
 * @param {string} [dateSgt] - YYYY-MM-DD match date in SGT
 * @returns {Promise<string>}
 */
async function gatherObsidianContext(team1, team2, venue = null, dateSgt = null) {
  const parts = [];

  try {
    const [r1, r2] = await Promise.all([
      obsidianGet(`/search?q=${encodeURIComponent(team1)}`),
      obsidianGet(`/search?q=${encodeURIComponent(team2)}`),
    ]);

    if (r1.results && r1.results.length > 0) {
      const best = r1.results[0];
      parts.push(`--- ${team1} Notes (${best.filename}) ---\n${best.content}`);
    }
    if (r2.results && r2.results.length > 0) {
      const best = r2.results[0];
      parts.push(`--- ${team2} Notes (${best.filename}) ---\n${best.content}`);
    }
  } catch (err) {
    console.log('[OBSIDIAN] Search error (non-fatal):', err.message);
  }

  // Try head-to-head note
  try {
    const h2h = await obsidianGet('/read/WC2026%2Fhead-to-head.md');
    if (h2h.content) {
      const section = extractH2HSection(h2h.content, team1, team2);
      if (section) parts.push(`--- Head-to-Head ---\n${section}`);
    }
  } catch {
    // H2H note doesn't exist — that's fine
  }

  // Live standings — gives Qwen the real tournament table (updated after every result)
  try {
    const standings = await obsidianGet('/read/WC2026%2Flive-standings.md');
    if (standings.content) parts.push(`--- LIVE STANDINGS (current) ---\n${standings.content.slice(0, 1500)}`);
  } catch {}

  // Tournament form — actual in-tournament performance of both teams
  try {
    const formNote = await obsidianGet('/read/WC2026%2Ftournament-form.md');
    if (formNote.content) {
      const formLines = formNote.content.split('\n');
      // Extract only the sections for team1 and team2
      const relevant = [];
      let capture = false;
      for (const line of formLines) {
        if (line.startsWith(`## ${team1}`) || line.startsWith(`## ${team2}`)) capture = true;
        else if (line.startsWith('## ') && capture) capture = false;
        if (capture) relevant.push(line);
      }
      if (relevant.length > 0) parts.push(`--- TOURNAMENT FORM (actual WC2026 performance) ---\n${relevant.join('\n')}`);
    }
  } catch {}

  // Knockout bracket if available
  try {
    const ko = await obsidianGet('/read/WC2026%2Fknockout-bracket.md');
    if (ko.content) parts.push(`--- KNOCKOUT BRACKET ---\n${ko.content.slice(0, 800)}`);
  } catch {}

  // Squad news and injuries
  try {
    const squadNews = await obsidianGet('/read/WC2026%2Fsquad-news.md');
    if (squadNews.content) {
      const lines = squadNews.content.split('\n');
      const relevant = [];
      let capture = false;
      for (const line of lines) {
        if (line.startsWith(`## ${team1}`) || line.startsWith(`## ${team2}`)) capture = true;
        else if (line.startsWith('## ') && capture) capture = false;
        if (capture) relevant.push(line);
      }
      if (relevant.length > 0) parts.push(`--- SQUAD NEWS ---\n${relevant.join('\n')}`);
    }
  } catch {}

  // Weather context — fetched live from Open-Meteo (free, no key)
  if (venue && dateSgt) {
    try {
      const weather = await fetchMatchWeather(venue, dateSgt);
      const weatherCtx = buildWeatherContext(weather);
      if (weatherCtx) parts.push(weatherCtx);
    } catch (err) {
      console.log('[WEATHER] Fetch error (non-fatal):', err.message);
    }
  }

  return parts.join('\n\n');
}

/**
 * Extract a H2H section from the head-to-head note for a specific matchup.
 * @param {string} content
 * @param {string} team1
 * @param {string} team2
 * @returns {string|null}
 */
function extractH2HSection(content, team1, team2) {
  const lines = content.split('\n');
  const headerPattern = new RegExp(
    `${team1}.*${team2}|${team2}.*${team1}`,
    'i'
  );
  let inSection = false;
  const sectionLines = [];

  for (const line of lines) {
    if (line.startsWith('## ') && headerPattern.test(line)) {
      inSection = true;
      sectionLines.push(line);
    } else if (inSection && line.startsWith('## ')) {
      break;
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.length > 1 ? sectionLines.join('\n') : null;
}

/**
 * Format a prediction result as an Obsidian markdown note.
 * @param {object} prediction
 * @param {object} fixture
 * @returns {string}
 */
function formatPredictionNote(prediction, fixture) {
  const now = new Date().toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return `# ${fixture.team1} vs ${fixture.team2} — Group ${fixture.group}
**Date (SGT):** ${fixture.dateSgt}
**Venue:** ${fixture.venue}

## AI Prediction (${OLLAMA_MODEL})
- **Winner:** ${prediction.winner}
- **Score:** ${prediction.predicted_score}
- **Confidence:** ${prediction.confidence}%
- **Risk:** ${prediction.risk_factor}

## Key Factors
${(prediction.key_factors || []).map((f, i) => `${i + 1}. ${f}`).join('\n')}

## Analysis
${prediction.analysis_summary}

*Generated: ${now} SGT*
`;
}

// ─── ANALYZE PIPELINE ──────────────────────────────────────────────────────

/**
 * POST /api/analyze/:matchId
 * Multi-agent analysis pipeline.
 * Query param: ?mode=full (5 agents, default) | ?mode=fast (single improved Qwen call)
 */
app.post('/api/analyze/:matchId', async (req, res) => {
  const { matchId } = req.params;
  const mode = (req.query.mode === 'fast') ? 'fast' : 'full';
  const fixture = FIXTURES.find((f) => f.matchId === matchId);

  if (!fixture) {
    return res.status(404).json({ error: 'Match not found', matchId });
  }

  const { team1, team2, group } = fixture;
  console.log(`[WC2026] Analyze (${mode}): ${team1} vs ${team2} (Group ${group})`);

  // Deps bundle — injected into orchestrator to keep agents decoupled
  const deps = {
    runOllama,
    TEAM_STATS,
    obsidianGet,
    obsidianPost,
    gatherObsidianContext,
    fetchMatchWeather,
    buildWeatherContext,
  };

  let ollamaResult;
  try {
    ollamaResult = await runOrchestrator(fixture, deps, mode);
  } catch (err) {
    console.error('[WC2026] Orchestrator error:', err.message);
    return res.status(503).json({ error: 'Analysis pipeline failed', details: err.message });
  }

  // Strip internal agent debug fields before saving
  const { _mode, _agentReports, _statReport, ...cleanResult } = ollamaResult;

  // Translate analysis to Chinese for the bilingual Telegram card (non-fatal)
  const zh = await translateAnalysisToZh(cleanResult);
  if (zh) Object.assign(cleanResult, zh);

  // Build full prediction object
  const prediction = {
    matchId,
    team1,
    team2,
    group,
    dateSgt: fixture.dateSgt,
    timeSgt: fixture.timeSgt,
    venue: fixture.venue,
    analyzedAt: new Date().toISOString(),
    analysisMode: mode,
    ...cleanResult,
    // Store agent votes if full mode ran
    agentVotes: _agentReports ? {
      statistical: _agentReports.stat?.statWinner,
      tactical:    _agentReports.tactical?.tacticalEdge,
      historical:  _agentReports.historian?.h2hVerdict,
      psychological: _agentReports.psych?.psychologicalEdge,
      devil_upset_pct: _agentReports.devil?.upsetProbability,
      statXG: { team1: _agentReports.stat?.xG1, team2: _agentReports.stat?.xG2 },
    } : undefined,
    telegramPosted: false,
    suppress: false,
  };

  // Atomic write to predictions.json
  const predictions = readJson(PREDICTIONS_FILE);
  predictions[matchId] = prediction;
  writeJson(PREDICTIONS_FILE, predictions);
  console.log(`[WC2026] Saved prediction: ${matchId} (${mode} mode)`);

  // Telegram (fire and forget)
  if (!prediction.suppress) {
    telegramPost('/send-analysis', prediction)
      .then(() => {
        const p = readJson(PREDICTIONS_FILE);
        if (p[matchId]) { p[matchId].telegramPosted = true; writeJson(PREDICTIONS_FILE, p); }
        console.log(`[TELEGRAM] Posted analysis for ${matchId}`);
      })
      .catch((err) => console.error('[TELEGRAM] Post failed (non-fatal):', err.message));
  }

  // Write to Obsidian (fire and forget)
  const noteContent = formatPredictionNote(prediction, fixture);
  obsidianPost('/write', { filename: `WC2026/predictions/${matchId}.md`, content: noteContent })
    .then(() => console.log(`[OBSIDIAN] Wrote prediction note: ${matchId}`))
    .catch((err) => console.error('[OBSIDIAN] Write failed (non-fatal):', err.message));

  res.json(prediction);
});

// ─── API ROUTES ────────────────────────────────────────────────────────────

/** GET /api/health */
app.get('/api/health', async (req, res) => {
  const [ollamaOk, obsidianOk, telegramOk] = await Promise.all([
    pingUrl(`${OLLAMA_HOST}/api/tags`),
    pingUrl(`${OBSIDIAN_MCP}/health`),
    pingUrl(`${TELEGRAM_MCP}/health`),
  ]);

  res.json({
    status: 'ok',
    ollama: { ok: ollamaOk, host: OLLAMA_HOST, model: OLLAMA_MODEL },
    obsidianMcp: { ok: obsidianOk, port: 3002 },
    telegramMcp: { ok: telegramOk, port: 3003 },
    env: {
      telegramToken: !!process.env.TELEGRAM_BOT_TOKEN,
      telegramChannel: !!process.env.TELEGRAM_CHANNEL_ID,
      obsidianVault: !!process.env.OBSIDIAN_VAULT_PATH,
      obsidianVaultPath: process.env.OBSIDIAN_VAULT_PATH || path.join(__dirname, 'vault') + ' (built-in)',
    },
    predictions: Object.keys(readJson(PREDICTIONS_FILE)).length,
    totalMatches: FIXTURES.length,
  });
});

/** GET /api/teams */
app.get('/api/teams', (req, res) => {
  res.json(TEAM_STATS);
});

/** GET /api/matches */
app.get('/api/matches', (req, res) => {
  const predictions = readJson(PREDICTIONS_FILE);
  const fixtures = FIXTURES.map((f) => ({
    ...f,
    analyzed: !!predictions[f.matchId],
    prediction: predictions[f.matchId] || null,
  }));
  res.json(fixtures);
});

/** GET /api/matches/:group */
app.get('/api/matches/:group', (req, res) => {
  const group = req.params.group.toUpperCase();
  const predictions = readJson(PREDICTIONS_FILE);
  const fixtures = FIXTURES
    .filter((f) => f.group === group)
    .map((f) => ({
      ...f,
      analyzed: !!predictions[f.matchId],
      prediction: predictions[f.matchId] || null,
    }));

  if (fixtures.length === 0) {
    return res.status(404).json({ error: `Group ${group} not found` });
  }
  res.json(fixtures);
});

/** GET /api/predictions */
app.get('/api/predictions', (req, res) => {
  res.json(readJson(PREDICTIONS_FILE));
});

/** GET /api/predictions/:matchId */
app.get('/api/predictions/:matchId', (req, res) => {
  const predictions = readJson(PREDICTIONS_FILE);
  const prediction = predictions[req.params.matchId];
  if (!prediction) return res.status(404).json({ error: 'Prediction not found' });
  res.json(prediction);
});

/** PATCH /api/predictions/:matchId/suppress */
app.patch('/api/predictions/:matchId/suppress', (req, res) => {
  const predictions = readJson(PREDICTIONS_FILE);
  const { matchId } = req.params;
  if (!predictions[matchId]) {
    return res.status(404).json({ error: 'Prediction not found' });
  }
  predictions[matchId].suppress = !predictions[matchId].suppress;
  writeJson(PREDICTIONS_FILE, predictions);
  res.json({ matchId, suppress: predictions[matchId].suppress });
});

/** POST /api/predictions/:matchId/publish */
app.post('/api/predictions/:matchId/publish', async (req, res) => {
  const predictions = readJson(PREDICTIONS_FILE);
  const { matchId } = req.params;
  const prediction = predictions[matchId];
  if (!prediction) return res.status(404).json({ error: 'Prediction not found' });

  try {
    await telegramPost('/send-analysis', prediction);
    predictions[matchId].telegramPosted = true;
    writeJson(PREDICTIONS_FILE, predictions);
    console.log(`[TELEGRAM] Manually published: ${matchId}`);
    res.json({ success: true, matchId });
  } catch (err) {
    console.error('[TELEGRAM] Publish error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/predictions */
app.delete('/api/predictions', (req, res) => {
  if (req.query.confirm !== 'yes') {
    return res.status(400).json({ error: 'Add ?confirm=yes to delete all predictions' });
  }
  writeJson(PREDICTIONS_FILE, {});
  console.log('[WC2026] All predictions cleared');
  res.json({ success: true, message: 'All predictions cleared' });
});

/** GET /api/export/csv */
app.get('/api/export/csv', (req, res) => {
  const predictions = readJson(PREDICTIONS_FILE);
  const rows = Object.values(predictions);
  if (rows.length === 0) return res.status(404).json({ error: 'No predictions to export' });

  const headers = ['matchId', 'team1', 'team2', 'group', 'dateSgt', 'winner',
    'predicted_score', 'confidence', 'risk_factor', 'analysis_summary'];
  const csv = [
    headers.join(','),
    ...rows.map((r) =>
      headers.map((h) => `"${String(r[h] || '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="wc2026-predictions.csv"');
  res.send(csv);
});

/** GET /api/summary */
app.get('/api/summary', (req, res) => {
  const predictions = readJson(PREDICTIONS_FILE);
  const summary = {};

  for (const letter of Object.keys(GROUPS)) {
    const groupMatches = FIXTURES.filter((f) => f.group === letter);
    const analyzed = groupMatches.filter((f) => predictions[f.matchId]);
    const wins = {};
    let totalGoals = 0;

    for (const fixture of analyzed) {
      const p = predictions[fixture.matchId];
      const winner = p.winner;
      if (winner !== 'draw') wins[winner] = (wins[winner] || 0) + 1;
      const [g1, g2] = (p.predicted_score || '0-0').split('-').map(Number);
      totalGoals += (g1 || 0) + (g2 || 0);
    }

    const leader = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
    summary[letter] = {
      analyzed: analyzed.length,
      total: groupMatches.length,
      leader: leader ? leader[0] : null,
      totalGoals,
      results: analyzed.map((f) => ({
        matchId: f.matchId,
        team1: f.team1,
        team2: f.team2,
        winner: predictions[f.matchId].winner,
        score: predictions[f.matchId].predicted_score,
        confidence: predictions[f.matchId].confidence,
      })),
    };
  }

  res.json(summary);
});

/** GET /api/obsidian/notes */
app.get('/api/obsidian/notes', async (req, res) => {
  try {
    const data = await obsidianGet('/list?folder=WC2026');
    res.json(data);
  } catch (err) {
    console.error('[OBSIDIAN] notes error:', err.message);
    res.status(503).json({ error: 'Obsidian MCP unreachable', details: err.message });
  }
});

/** GET /api/obsidian/note/:filename(*) */
app.get('/api/obsidian/note/:filename(*)', async (req, res) => {
  try {
    const filename = encodeURIComponent(req.params.filename);
    const data = await obsidianGet(`/read/${filename}`);
    res.json(data);
  } catch (err) {
    console.error('[OBSIDIAN] note read error:', err.message);
    res.status(503).json({ error: err.message });
  }
});

// ─── GOOGLE CALENDAR ROUTES ────────────────────────────────────────────────

/**
 * Build a Google Calendar event object for a fixture.
 * @param {object} fixture
 * @param {object|null} prediction
 * @returns {object}
 */
function buildCalendarEvent(fixture, prediction) {
  const start = new Date(fixture.dateIso);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  let description = `${fixture.team1} vs ${fixture.team2}\nGroup ${fixture.group}\nVenue: ${fixture.venue}`;
  if (prediction) {
    description += `\n\n🏆 AI Prediction: ${prediction.winner} ${prediction.predicted_score} (${prediction.confidence}% confidence)\n${prediction.analysis_summary}`;
  }

  return {
    summary: `⚽ WC2026: ${fixture.team1} vs ${fixture.team2} | Group ${fixture.group}`,
    description,
    start: { dateTime: start.toISOString(), timeZone: 'Asia/Singapore' },
    end: { dateTime: end.toISOString(), timeZone: 'Asia/Singapore' },
    colorId: prediction ? '10' : undefined,
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }],
    },
  };
}

/** POST /api/calendar/create/:matchId */
app.post('/api/calendar/create/:matchId', async (req, res) => {
  const { matchId } = req.params;
  const fixture = FIXTURES.find((f) => f.matchId === matchId);
  if (!fixture) return res.status(404).json({ error: 'Match not found' });

  const calendarEvents = readJson(CALENDAR_FILE);
  if (calendarEvents[matchId]) {
    return res.json({ success: true, alreadyExists: true, eventId: calendarEvents[matchId] });
  }

  const predictions = readJson(PREDICTIONS_FILE);
  const event = buildCalendarEvent(fixture, predictions[matchId] || null);

  // Use Google Calendar MCP
  const GCAL_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

  try {
    // Google Calendar integration is handled via Claude Code's connected Google Calendar MCP.
    // Mark as created locally so the UI can track it.
    calendarEvents[matchId] = `pending-${Date.now()}`;
    writeJson(CALENDAR_FILE, calendarEvents);
    console.log(`[CALENDAR] Marked event pending: ${matchId}`);
    res.json({
      success: true,
      matchId,
      event,
      note: 'Use /project:calendar-create or Claude Code Google Calendar MCP to create events',
    });
  } catch (err) {
    console.error('[CALENDAR] Create error:', err.message);
    res.status(503).json({ error: 'Calendar error', details: err.message });
  }
});

/** POST /api/calendar/create-all */
app.post('/api/calendar/create-all', async (req, res) => {
  const calendarEvents = readJson(CALENDAR_FILE);
  const predictions = readJson(PREDICTIONS_FILE);
  const results = [];
  let created = 0;
  let skipped = 0;

  for (const fixture of FIXTURES) {
    if (calendarEvents[fixture.matchId]) {
      skipped++;
      continue;
    }
    try {
      const event = buildCalendarEvent(fixture, predictions[fixture.matchId] || null);
      const GCAL_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
      // Attempt via fetch to Google Calendar API if MCP shim unavailable
      const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GCAL_ID)}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        timeout: 10000,
      });
      if (resp.ok) {
        const data = await resp.json();
        calendarEvents[fixture.matchId] = data.id || 'created';
        results.push({ matchId: fixture.matchId, status: 'created' });
        created++;
      } else {
        results.push({ matchId: fixture.matchId, status: 'error', code: resp.status });
      }
    } catch (err) {
      results.push({ matchId: fixture.matchId, status: 'error', message: err.message });
    }
  }

  writeJson(CALENDAR_FILE, calendarEvents);
  console.log(`[CALENDAR] create-all: ${created} created, ${skipped} skipped`);
  res.json({ created, skipped, total: FIXTURES.length, results });
});

// ─── SCHEDULER / ALERT ROUTES ──────────────────────────────────────────────

const { readResults, writeResult: saveResult, fetchTournamentStats } = require('./services/resultsService');
const { readLiveStore } = require('./services/liveMatchService');
const { isAlertSent } = require('./services/alertService');
const { readKnockout, writeKnockout } = require('./services/knockoutService');
const { analyzeKnockoutBracket } = require('./services/knockoutPredictionService');
const { fetchMatchWeather, buildWeatherContext } = require('./services/weatherService');
const { runOrchestrator } = require('./departments/executive/ceo');
const { computeCalibration, writeCalibrationToObsidian } = require('./departments/analytics/calibrationDesk');

const RESULTS_FILE = path.join(__dirname, 'data', 'match-results.json');
const SENT_ALERTS_FILE = path.join(__dirname, 'data', 'sent-alerts.json');

/** GET /api/countdown — countdown object to opening match */
app.get('/api/countdown', (req, res) => {
  const firstMatch = [...FIXTURES].sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso))[0];
  const diff = new Date(firstMatch.dateIso) - Date.now();
  const started = diff <= 0;
  const days = started ? 0 : Math.floor(diff / 86400000);
  const hours = started ? 0 : Math.floor((diff % 86400000) / 3600000);
  const minutes = started ? 0 : Math.floor((diff % 3600000) / 60000);
  const seconds = started ? 0 : Math.floor((diff % 60000) / 1000);
  res.json({ days, hours, minutes, seconds, started, nextMatch: firstMatch });
});

/** GET /api/alerts/sent — list all sent alerts */
app.get('/api/alerts/sent', (req, res) => {
  try {
    const data = fs.existsSync(SENT_ALERTS_FILE)
      ? JSON.parse(fs.readFileSync(SENT_ALERTS_FILE, 'utf8'))
      : {};
    res.json({ count: Object.keys(data).length, alerts: data });
  } catch {
    res.json({ count: 0, alerts: {} });
  }
});

/** POST /api/trigger/digest — manually fire daily digest */
app.post('/api/trigger/digest', async (req, res) => {
  try {
    const { sendDailyDigest } = require('./scheduler');
    await sendDailyDigest();
    res.json({ success: true });
  } catch (err) {
    // scheduler exports not available — call Telegram directly
    res.status(500).json({ error: 'Restart app and try again: ' + err.message });
  }
});

/** POST /api/trigger/preview/:matchId — manually fire 3-hour preview */
app.post('/api/trigger/preview/:matchId', async (req, res) => {
  const fixture = FIXTURES.find((f) => f.matchId === req.params.matchId);
  if (!fixture) return res.status(404).json({ error: 'Match not found' });
  res.json({ success: true, message: `Preview for ${fixture.team1} vs ${fixture.team2} — restart app to trigger via scheduler or use /api/analyze/${fixture.matchId}` });
});

/** GET /api/live — current live match data (updated every minute during matches) */
app.get('/api/live', (req, res) => {
  res.json(readLiveStore());
});

/** GET /api/results — all stored match results */
app.get('/api/results', (req, res) => {
  res.json(readResults());
});

/** GET /api/results/:matchId — single match result */
app.get('/api/results/:matchId', (req, res) => {
  const results = readResults();
  const result = results[req.params.matchId];
  if (!result) return res.status(404).json({ error: 'Result not found' });
  res.json(result);
});

/** POST /api/results/:matchId — manually save a result */
app.post('/api/results/:matchId', (req, res) => {
  const { matchId } = req.params;
  const fixture = FIXTURES.find((f) => f.matchId === matchId);
  if (!fixture) return res.status(404).json({ error: 'Match not found' });
  const { score1, score2, goalscorers = [], cards = [], stats = {} } = req.body;
  if (score1 === undefined || score2 === undefined) {
    return res.status(400).json({ error: 'score1 and score2 required' });
  }
  saveResult(matchId, { score1, score2, goalscorers, cards, stats, source: 'manual' });
  console.log(`[WC2026] Manual result saved: ${matchId} — ${score1}-${score2}`);
  res.json({ success: true, matchId, score1, score2 });
});

/** GET /api/tournament-stats */
app.get('/api/tournament-stats', (req, res) => {
  res.json(fetchTournamentStats());
});

/** GET /api/calibration — prediction accuracy vs real results */
app.get('/api/calibration', async (req, res) => {
  try {
    const report = computeCalibration();
    // Fire-and-forget write to Obsidian
    writeCalibrationToObsidian(report).catch(() => {});
    res.json(report);
  } catch (err) {
    console.error('[CALIBRATION] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/calibration/sync
 * Manually trigger calibration write to Obsidian vault.
 */
app.post('/api/calibration/sync', async (req, res) => {
  try {
    const report = computeCalibration();
    await writeCalibrationToObsidian(report);
    res.json({ success: true, totalCompared: report.totalCompared, outcomeAccuracy: report.outcomeAccuracy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── KNOCKOUT PREDICTION ROUTES ───────────────────────────────────────────────

/** GET /api/knockout — full knockout data: actual results + Qwen predictions */
app.get('/api/knockout', (req, res) => {
  res.json(readKnockout());
});

/**
 * POST /api/analyze/knockout
 * Stream Qwen bracket predictions from R32 → Final via Server-Sent Events.
 * Each match emits a data event; final event has type=complete with champion.
 * Full run: 31 Qwen calls (~20-60 min depending on Ollama speed).
 */
app.post('/api/analyze/knockout', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const deps = {
    runOllama,
    gatherObsidianContext,
    obsidianPost,
    telegramPost,
    writeJson,
    readJson,
    TEAM_STATS,
  };

  console.log('[KNOCKOUT] Starting full bracket analysis...');
  try {
    const bracket = await analyzeKnockoutBracket(deps, send);
    send({ type: 'complete', champion: bracket.champion, bracket });
    console.log(`[KNOCKOUT] Bracket analysis done — champion: ${bracket.champion}`);
  } catch (err) {
    console.error('[KNOCKOUT] Analysis failed:', err.message);
    send({ type: 'error', message: err.message });
  }
  res.end();
});

/**
 * POST /api/analyze/knockout/reset
 * Clear Qwen knockout predictions only — actual API results are preserved.
 */
app.post('/api/analyze/knockout/reset', (req, res) => {
  const ko = readKnockout();
  delete ko.predictions;
  writeKnockout(ko);
  console.log('[KNOCKOUT] Predictions cleared');
  res.json({ success: true, message: 'Knockout predictions cleared' });
});

// ─── COUNTDOWN ─────────────────────────────────────────────────────────────

/**
 * Build a countdown string from now to a target date.
 * @param {Date} target
 * @returns {string}
 */
function buildCountdown(target) {
  const diff = target - Date.now();
  if (diff <= 0) return 'The tournament has started\\!';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${days}d ${hours}h ${mins}m ${secs}s`;
}

/**
 * POST /api/countdown
 * Send a countdown-to-kickoff message to Telegram.
 */
app.post('/api/countdown', async (req, res) => {
  const firstMatch = [...FIXTURES].sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso))[0];
  const target = new Date(firstMatch.dateIso);
  const countdown = buildCountdown(target);

  const escapeMd = (t) => String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);

  const msg = [
    `⚽ *FIFA WORLD CUP 2026*`,
    ``,
    `🏟 *Opening Match*`,
    `*${escapeMd(firstMatch.team1)}* vs *${escapeMd(firstMatch.team2)}*`,
    `📅 ${escapeMd(firstMatch.dateSgt)} SGT \\| Group ${escapeMd(firstMatch.group)}`,
    `📍 ${escapeMd(firstMatch.venue)}`,
    ``,
    `⏳ *Countdown:*`,
    `\`${escapeMd(countdown)}\``,
    ``,
    `_Let the games begin\\!_ 🌍`,
  ].join('\n');

  try {
    await telegramPost('/send', { message: msg, parse_mode: 'MarkdownV2' });
    console.log(`[WC2026] Countdown sent: ${countdown}`);
    res.json({ success: true, countdown, firstMatch: firstMatch.matchId });
  } catch (err) {
    console.error('[WC2026] Countdown error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DAILY DIGEST SCHEDULER ────────────────────────────────────────────────

/**
 * Parse DIGEST_TIME_SGT (HH:mm) to a cron expression.
 * @param {string} timeStr
 * @returns {string}
 */
function digestToCron(timeStr) {
  const [hh, mm] = (timeStr || '08:00').split(':').map(Number);
  return `${mm || 0} ${hh || 8} * * *`;
}

cron.schedule(digestToCron(DIGEST_TIME_SGT), async () => {
  const today = todaySgt();
  const todayMatches = FIXTURES.filter((f) => {
    const matchDate = new Date(f.dateIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    return matchDate === today;
  });

  if (todayMatches.length === 0) {
    console.log(`[WC2026] Daily digest: no matches today (${today})`);
    return;
  }

  const predictions = readJson(PREDICTIONS_FILE);
  const digestMatches = todayMatches.map((m) => ({
    ...m,
    prediction: predictions[m.matchId] || null,
    suppress: predictions[m.matchId]?.suppress || false,
  }));

  try {
    await telegramPost('/send-digest', { matches: digestMatches, dateSgt: today });
    console.log(`[TELEGRAM] Digest sent: ${todayMatches.length} matches for ${today}`);
  } catch (err) {
    console.error('[TELEGRAM] Digest error:', err.message);
  }
}, { timezone: 'Asia/Singapore' });

// ─── STARTUP HEALTH CHECK ──────────────────────────────────────────────────

/**
 * Ping MCP servers on startup and log status.
 */
async function startupHealthCheck() {
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const [ollamaOk, obsidianOk, telegramOk] = await Promise.all([
    pingUrl(`${OLLAMA_HOST}/api/tags`),
    pingUrl(`${OBSIDIAN_MCP}/health`),
    pingUrl(`${TELEGRAM_MCP}/health`),
  ]);

  console.log(`[WC2026] Startup health check:`);
  console.log(`  Ollama (${OLLAMA_HOST}): ${ollamaOk ? '✓ OK' : '✗ OFFLINE'}`);
  console.log(`  Obsidian MCP (:3002): ${obsidianOk ? '✓ OK' : '✗ OFFLINE'}`);
  console.log(`  Telegram MCP (:3003): ${telegramOk ? '✓ OK' : '✗ OFFLINE'}`);
  console.log(`  TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✓ set' : '✗ not set'}`);
  console.log(`  TELEGRAM_CHANNEL_ID: ${process.env.TELEGRAM_CHANNEL_ID ? '✓ set' : '✗ not set'}`);
  const vaultDisplay = process.env.OBSIDIAN_VAULT_PATH
    ? process.env.OBSIDIAN_VAULT_PATH
    : `${path.join(__dirname, 'vault')} (built-in)`;
  console.log(`  OBSIDIAN_VAULT_PATH: ${vaultDisplay}`);
  console.log(`  Fixtures loaded: ${FIXTURES.length}`);
}

// ─── START SERVER ──────────────────────────────────────────────────────────

// ─── GRACEFUL SHUTDOWN ─────────────────────────────────────────────────────

async function handleShutdown(signal) {
  console.log(`[WC2026] Received ${signal} — shutting down...`);
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHANNEL_ID;
  if (token && chatId) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    chatId,
          text:       `🔴 <b>WC2026 Predictor stopped</b>\nReason: ${signal}\n${new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} SGT`,
          parse_mode: 'HTML',
        }),
      });
    } catch (err) {
      console.error('[WC2026] Shutdown Telegram failed:', err.message);
    }
  }
  process.exit(0);
}

process.on('SIGINT',  () => handleShutdown('SIGINT').catch(() => process.exit(1)));
process.on('SIGTERM', () => handleShutdown('SIGTERM').catch(() => process.exit(1)));

// ─── START SERVER ──────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[WC2026] Server running on http://localhost:${PORT}`);
  startupHealthCheck();
  // Sync real kickoff times from football-data.org API (runs async, non-blocking)
  setTimeout(syncFixturesFromApi, 3000);
});
