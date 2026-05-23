'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const RESULTS_FILE = path.join(__dirname, '../data/match-results.json');
const OBSIDIAN_MCP = 'http://localhost:3002';

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
    const data = await resp.json();

    if (!data.matches) return null;

    // Try to match by approximate team name
    const parts = matchId.split('-vs-');
    if (parts.length < 2) return null;
    const t1Slug = parts[0].split('-').slice(1).join(' ');
    const t2Slug = parts[1].replace(/-/g, ' ');

    const match = data.matches.find((m) => {
      const home = (m.homeTeam?.name || '').toLowerCase();
      const away = (m.awayTeam?.name || '').toLowerCase();
      return (home.includes(t1Slug) || away.includes(t1Slug)) &&
             (home.includes(t2Slug) || away.includes(t2Slug));
    });

    if (!match || match.status !== 'FINISHED') return null;

    return {
      score1: match.score?.fullTime?.home ?? 0,
      score2: match.score?.fullTime?.away ?? 0,
      goalscorers: [],
      cards: [],
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
