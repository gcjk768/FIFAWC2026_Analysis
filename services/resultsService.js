'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const RESULTS_FILE = path.join(__dirname, '../data/match-results.json');
const OBSIDIAN_MCP = 'http://localhost:3002';

// football-data.org uses different team names — map to our canonical names
const API_NAME_MAP = {
  'bosnia-herzegovina':    'Bosnia and Herzegovina',
  'united states':         'USA',
  'republic of ireland':   'Ireland',
  'czech republic':        'Czechia',
  'türkiye':               'Turkiye',
  'turkey':                'Turkiye',
  'ivory coast':           'Ivory Coast',
  "côte d'ivoire":         'Ivory Coast',
  'democratic republic of the congo': 'DR Congo',
  'dr congo':              'DR Congo',
  'cape verde':            'Cape Verde',
  'new zealand':           'New Zealand',
  'south korea':           'South Korea',
  'republic of korea':     'South Korea',
  'saudi arabia':          'Saudi Arabia',
  'south africa':          'South Africa',
};

/**
 * Normalise an API team name to our canonical name.
 * @param {string} name
 * @returns {string}
 */
function normaliseTeamName(name) {
  if (!name) return name;
  return API_NAME_MAP[name.toLowerCase()] || name;
}

// ─── FILE HELPERS ────────────────────────────────────────────────────────────

/**
 * Read match-results.json safely.
 * @returns {object}
 */
function readResults() {
  try {
    if (!fs.existsSync(RESULTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write a result atomically to match-results.json.
 * @param {string} matchId
 * @param {object} result
 */
function writeResult(matchId, result) {
  const all = readResults();
  all[matchId] = { ...result, savedAt: new Date().toISOString() };
  const tmp = RESULTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, RESULTS_FILE);
}

// ─── FOOTBALL API ────────────────────────────────────────────────────────────

/**
 * Poll football-data.org for a match result.
 * @param {string} matchId - our internal matchId
 * @param {string} kickoffSgt - ISO string of kickoff in SGT
 * @returns {Promise<object|null>} result object or null if not finished
 */
async function fetchMatchResult(matchId, kickoffSgt) {
  if (!FOOTBALL_API_KEY) {
    console.log('[RESULTS] No FOOTBALL_API_KEY — cannot auto-fetch results');
    return null;
  }

  try {
    const date = new Date(kickoffSgt).toISOString().slice(0, 10);
    const url = `https://api.football-data.org/v4/matches?competition=WC&dateFrom=${date}&dateTo=${date}`;
    const resp = await fetch(url, {
      headers: { 'X-Auth-Token': FOOTBALL_API_KEY },
      timeout: 10000,
    });

    // Respect rate limit headers (free tier: 10 calls/min)
    const remaining = resp.headers.get('X-Requests-Available-Minute');
    const reset = resp.headers.get('X-RequestCounter-Reset');
    if (remaining !== null && Number(remaining) <= 1) {
      const waitMs = reset ? Math.max(0, Number(reset) * 1000 - Date.now()) : 30000;
      console.warn(`[RESULTS] Rate limit almost reached — backing off ${Math.round(waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    if (resp.status === 429) {
      console.warn('[RESULTS] Rate limited by football-data.org — will retry next poll cycle');
      return null;
    }

    const data = await resp.json();
    if (!data.matches) return null;

    // Parse team names from matchId slug (format: g-{group}-{team1}-vs-{team2})
    const vsSplit = matchId.indexOf('-vs-');
    if (vsSplit === -1) return null;
    const t1Slug = matchId.slice(matchId.indexOf('-', 2) + 1, vsSplit).replace(/-/g, ' ');
    const t2Slug = matchId.slice(vsSplit + 4).replace(/-/g, ' ');

    const match = data.matches.find((m) => {
      const home = normaliseTeamName(m.homeTeam?.name || '').toLowerCase();
      const away = normaliseTeamName(m.awayTeam?.name || '').toLowerCase();
      const t1 = t1Slug.toLowerCase();
      const t2 = t2Slug.toLowerCase();
      return (home === t1 || away === t1 || home.includes(t1) || t1.includes(home)) &&
             (home === t2 || away === t2 || away.includes(t2) || t2.includes(away));
    });

    if (!match || match.status !== 'FINISHED') return null;

    return {
      score1: match.score?.fullTime?.home ?? 0,
      score2: match.score?.fullTime?.away ?? 0,
      goalscorers: (match.goals || []).map((g) => ({ player: g.scorer?.name || '?', team: normaliseTeamName(g.team?.name), minute: g.minute })),
      cards: (match.bookings || []).map((b) => ({ player: b.player?.name || '?', team: normaliseTeamName(b.team?.name), type: b.card, minute: b.minute })),
      stats: {},
      source: 'football-data.org',
    };
  } catch (err) {
    console.error('[RESULTS] fetchMatchResult error:', err.message);
    return null;
  }
}

/**
 * Fetch weather for a city using wttr.in (free, no API key needed).
 * @param {string} city
 * @returns {Promise<string>} Formatted weather line
 */
async function fetchWeather(city) {
  try {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=3`;
    const resp = await fetch(url, { timeout: 8000 });
    const text = await resp.text();
    return text.trim();
  } catch (err) {
    console.error('[RESULTS] fetchWeather error:', err.message);
    return '';
  }
}

// ─── TOURNAMENT STATS ────────────────────────────────────────────────────────

/**
 * Compute basic tournament stats from stored results.
 * @returns {{ totalGoals: number, matchesPlayed: number, avgGoalsPerGame: number }}
 */
function fetchTournamentStats() {
  const results = readResults();
  const entries = Object.values(results);
  const matchesPlayed = entries.length;
  const totalGoals = entries.reduce((sum, r) => sum + (r.score1 || 0) + (r.score2 || 0), 0);
  const avgGoalsPerGame = matchesPlayed > 0 ? (totalGoals / matchesPlayed).toFixed(2) : '0.00';
  return { totalGoals, matchesPlayed, avgGoalsPerGame };
}

// ─── OBSIDIAN WRITE ──────────────────────────────────────────────────────────

/**
 * Write a match result note to Obsidian.
 * @param {string} matchId
 * @param {object} fixture
 * @param {object} result
 * @param {object|null} prediction
 * @returns {Promise<void>}
 */
async function writeResultToObsidian(matchId, fixture, result, prediction) {
  const { team1, team2, group, dateSgt, venue } = fixture;
  const { score1, score2, goalscorers = [], cards = [], stats = {} } = result;
  const pred = prediction || {};

  const actualWinner = score1 > score2 ? team1 : score2 > score1 ? team2 : 'draw';
  const predWinner = pred.winner || '?';
  const accuracy = predWinner === actualWinner
    ? (pred.predicted_score === `${score1}-${score2}` ? '✅ Perfect' : '🤏 Correct winner')
    : '❌ Wrong';

  const goalLines = goalscorers.length
    ? goalscorers.map((g) => `- ${g.minute}' ${g.player} (${g.team})`).join('\n')
    : '- No goalscorer data';

  const cardLines = cards.length
    ? cards.map((c) => `- ${c.minute}' ${c.player} (${c.team}) — ${c.type}`).join('\n')
    : '- No card data';

  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });

  const content = `# ${team1} vs ${team2} — Group ${group}
Date: ${dateSgt} SGT | Venue: ${venue}

## Final Result
**${team1} ${score1} — ${score2} ${team2}**

## Goals
${goalLines}

## Cards
${cardLines}

## Match Stats
| Stat | ${team1} | ${team2} |
|------|---------|---------|
| Possession | ${stats.possession1 || '?'}% | ${stats.possession2 || '?'}% |
| Shots | ${stats.shots1 || '?'} | ${stats.shots2 || '?'} |
| On Target | ${stats.onTarget1 || '?'} | ${stats.onTarget2 || '?'} |

## AI Prediction vs Actual
- Predicted: ${pred.predicted_score || '?'} (${predWinner})
- Actual: ${score1}-${score2} (${actualWinner})
- Accuracy: ${accuracy}

## Key Takeaways for Next Analysis
- Review ${team1} defensive shape vs actual performance
- Review ${team2} attacking effectiveness
- Update tournament stats after this result

*Auto-generated by WC2026 Predictor — ${now} SGT*
`;

  try {
    await fetch(`${OBSIDIAN_MCP}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: `WC2026/results/${matchId}.md`, content }),
    });
    console.log(`[OBSIDIAN] Result note written: ${matchId}`);
  } catch (err) {
    console.error('[OBSIDIAN] writeResultToObsidian error:', err.message);
  }
}

module.exports = {
  readResults,
  writeResult,
  fetchMatchResult,
  fetchWeather,
  fetchTournamentStats,
  writeResultToObsidian,
};
