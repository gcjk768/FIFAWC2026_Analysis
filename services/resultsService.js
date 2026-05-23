'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const RESULTS_FILE = path.join(__dirname, '../data/match-results.json');
const OBSIDIAN_MCP = 'http://localhost:3002';

// football-data.org team name → our canonical name
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

// ESPN team name → our canonical name
const ESPN_NAME_MAP = {
  'united states':                 'USA',
  'ivory coast':                   'Ivory Coast',
  "côte d'ivoire":                 'Ivory Coast',
  'democratic republic of congo':  'DR Congo',
  'czech republic':                'Czechia',
  'türkiye':                       'Turkiye',
  'turkey':                        'Turkiye',
  'south korea':                   'South Korea',
  'republic of korea':             'South Korea',
  'bosnia and herzegovina':        'Bosnia and Herzegovina',
  'bosnia-herzegovina':            'Bosnia and Herzegovina',
};

/**
 * Normalise a football-data.org team name to our canonical name.
 * @param {string} name
 * @returns {string}
 */
function normaliseTeamName(name) {
  if (!name) return name;
  return API_NAME_MAP[name.toLowerCase()] || name;
}

/**
 * Normalise an ESPN team name to our canonical name.
 * @param {string} name
 * @returns {string}
 */
function normaliseEspnName(name) {
  if (!name) return '';
  return ESPN_NAME_MAP[name.toLowerCase()] || name;
}

/**
 * Check if an ESPN display name loosely matches one of our canonical team names.
 * @param {string} espnName
 * @param {string} ourName
 * @returns {boolean}
 */
function espnNameMatches(espnName, ourName) {
  const n = normaliseEspnName(espnName).toLowerCase();
  const o = ourName.toLowerCase();
  return n === o || n.includes(o) || o.includes(n);
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

// ─── FOOTBALL-DATA.ORG ───────────────────────────────────────────────────────

/**
 * Poll football-data.org for a match result.
 * Returns HT/FT scores, goalscorers, cards, and substitutions.
 * @param {string} matchId
 * @param {string} kickoffSgt - ISO string of kickoff in SGT
 * @returns {Promise<object|null>}
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
      score1:    match.score?.fullTime?.home ?? 0,
      score2:    match.score?.fullTime?.away ?? 0,
      htScore1:  match.score?.halfTime?.home ?? null,
      htScore2:  match.score?.halfTime?.away ?? null,
      goalscorers: (match.goals || []).map((g) => ({
        player:  g.scorer?.name || '?',
        team:    normaliseTeamName(g.team?.name),
        minute:  g.minute,
        type:    g.type || 'REGULAR',
      })),
      cards: (match.bookings || []).map((b) => ({
        player: b.player?.name || '?',
        team:   normaliseTeamName(b.team?.name),
        type:   b.card,
        minute: b.minute,
      })),
      substitutions: (match.substitutions || []).map((s) => ({
        playerOut: s.playerOut?.name || '?',
        playerIn:  s.playerIn?.name  || '?',
        team:      normaliseTeamName(s.team?.name),
        minute:    s.minute,
      })),
      stats:  {},
      source: 'football-data.org',
    };
  } catch (err) {
    console.error('[RESULTS] fetchMatchResult error:', err.message);
    return null;
  }
}

// ─── ESPN UNOFFICIAL API ──────────────────────────────────────────────────────

/**
 * Extract a numeric stat value from an ESPN statistics array.
 * Tries multiple possible stat names (ESPN uses inconsistent names).
 * @param {object[]} stats
 * @param {string[]} keys
 * @returns {string|null}
 */
function espnStat(stats, keys) {
  for (const key of keys) {
    const found = stats.find((s) => s.name === key);
    if (found?.displayValue) return found.displayValue.replace('%', '').trim();
  }
  return null;
}

/**
 * Fetch team-level match stats from ESPN's unofficial public API.
 * No API key required. Returns possession, shots, passes, corners, fouls, saves.
 * @param {string} team1
 * @param {string} team2
 * @param {string} kickoffSgt - ISO string (used to derive YYYYMMDD date)
 * @returns {Promise<object|null>}
 */
async function fetchEspnStats(team1, team2, kickoffSgt) {
  try {
    const dateStr = new Date(kickoffSgt)
      .toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })
      .replace(/-/g, '');

    // Step 1: find the ESPN event ID from the scoreboard
    const sbResp = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`,
      { timeout: 12000 }
    );
    if (!sbResp.ok) {
      console.warn(`[RESULTS] ESPN scoreboard HTTP ${sbResp.status}`);
      return null;
    }
    const sbData = await sbResp.json();

    const event = (sbData.events || []).find((e) => {
      const comps = e.competitions?.[0]?.competitors || [];
      const t1Match = comps.some((c) => espnNameMatches(c.team?.displayName || '', team1));
      const t2Match = comps.some((c) => espnNameMatches(c.team?.displayName || '', team2));
      return t1Match && t2Match;
    });

    if (!event) {
      console.log(`[RESULTS] ESPN: no event found for ${team1} vs ${team2} on ${dateStr}`);
      return null;
    }

    // Only proceed if the match is finished
    const statusName = event.competitions?.[0]?.status?.type?.name || '';
    if (statusName !== 'STATUS_FINAL') {
      console.log(`[RESULTS] ESPN: match not yet finished (${statusName})`);
      return null;
    }

    // Step 2: get detailed stats from the summary endpoint
    const sumResp = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${event.id}`,
      { timeout: 12000 }
    );
    if (!sumResp.ok) {
      console.warn(`[RESULTS] ESPN summary HTTP ${sumResp.status}`);
      return null;
    }
    const sumData = await sumResp.json();

    const boxTeams = sumData.boxscore?.teams || [];
    if (boxTeams.length < 2) {
      console.log('[RESULTS] ESPN: boxscore teams not available yet');
      return null;
    }

    // Map each boxTeam to team1 / team2 by display name
    let st1 = null;
    let st2 = null;
    for (const bt of boxTeams) {
      const eName = bt.team?.displayName || '';
      if (espnNameMatches(eName, team1))      st1 = bt.statistics || [];
      else if (espnNameMatches(eName, team2)) st2 = bt.statistics || [];
    }
    // Fallback to positional if name matching failed
    if (!st1) st1 = boxTeams[0]?.statistics || [];
    if (!st2) st2 = boxTeams[1]?.statistics || [];

    const result = {
      possession1:    espnStat(st1, ['possessionPct', 'ballPossession', 'possession']),
      possession2:    espnStat(st2, ['possessionPct', 'ballPossession', 'possession']),
      shots1:         espnStat(st1, ['totalShots', 'shotsTotal', 'shots']),
      shots2:         espnStat(st2, ['totalShots', 'shotsTotal', 'shots']),
      shotsOnTarget1: espnStat(st1, ['shotsOnTarget', 'totalShotsOnGoal', 'onTargetAttempts']),
      shotsOnTarget2: espnStat(st2, ['shotsOnTarget', 'totalShotsOnGoal', 'onTargetAttempts']),
      corners1:       espnStat(st1, ['cornerKicks', 'corners']),
      corners2:       espnStat(st2, ['cornerKicks', 'corners']),
      fouls1:         espnStat(st1, ['fouls', 'foulsConceded']),
      fouls2:         espnStat(st2, ['fouls', 'foulsConceded']),
      offsides1:      espnStat(st1, ['offsides']),
      offsides2:      espnStat(st2, ['offsides']),
      saves1:         espnStat(st1, ['saves', 'goalKeeperSaves']),
      saves2:         espnStat(st2, ['saves', 'goalKeeperSaves']),
      passes1:        espnStat(st1, ['totalPasses', 'passes', 'passingAttempts']),
      passes2:        espnStat(st2, ['totalPasses', 'passes', 'passingAttempts']),
      passAccuracy1:  espnStat(st1, ['passesCompletedPercentage', 'passAccuracy', 'accuratePasses']),
      passAccuracy2:  espnStat(st2, ['passesCompletedPercentage', 'passAccuracy', 'accuratePasses']),
      source: 'espn',
    };

    console.log(`[RESULTS] ESPN stats fetched for ${team1} vs ${team2}`);
    return result;
  } catch (err) {
    console.error('[RESULTS] fetchEspnStats error:', err.message);
    return null;
  }
}

/**
 * Fetch full match data: football-data.org (scores/events) + ESPN (team stats).
 * @param {string} matchId
 * @param {string} team1
 * @param {string} team2
 * @param {string} kickoffSgt
 * @returns {Promise<object|null>}
 */
async function fetchFullMatchData(matchId, team1, team2, kickoffSgt) {
  const base = await fetchMatchResult(matchId, kickoffSgt);
  if (!base) return null;

  // ESPN stats are supplemental — failure is non-fatal
  const espn = await fetchEspnStats(team1, team2, kickoffSgt);
  if (espn) {
    base.stats = espn;
    console.log(`[RESULTS] Full match data assembled for ${matchId}`);
  } else {
    console.log(`[RESULTS] ESPN stats unavailable for ${matchId} — using scores only`);
  }

  return base;
}

// ─── WEATHER ─────────────────────────────────────────────────────────────────

/**
 * Fetch weather for a city using wttr.in (free, no API key needed).
 * @param {string} city
 * @returns {Promise<string>}
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
 * Write a full match result note to Obsidian vault.
 * @param {string} matchId
 * @param {object} fixture
 * @param {object} result
 * @param {object|null} prediction
 * @returns {Promise<void>}
 */
async function writeResultToObsidian(matchId, fixture, result, prediction) {
  const { team1, team2, group, dateSgt, venue } = fixture;
  const {
    score1, score2, htScore1, htScore2,
    goalscorers = [], cards = [], substitutions = [], stats = {},
  } = result;
  const pred = prediction || {};

  const actualWinner = score1 > score2 ? team1 : score2 > score1 ? team2 : 'draw';
  const predWinner = pred.winner || '?';
  const accuracy = predWinner === actualWinner
    ? (pred.predicted_score === `${score1}-${score2}` ? '✅ Perfect' : '🤏 Correct winner')
    : '❌ Wrong';

  const goalLines = goalscorers.length
    ? goalscorers.map((g) => {
        const pen = g.type === 'PENALTY' ? ' (pen)' : g.type === 'OWN_GOAL' ? ' (og)' : '';
        return `- ${g.minute}' ${g.player} (${g.team})${pen}`;
      }).join('\n')
    : '- No goalscorer data';

  const cardLines = cards.length
    ? cards.map((c) => `- ${c.minute}' ${c.player} (${c.team}) — ${c.type}`).join('\n')
    : '- No card data';

  const subLines = substitutions.length
    ? substitutions.map((s) => `- ${s.minute}' ${s.playerOut} → ${s.playerIn} (${s.team})`).join('\n')
    : '- No substitution data';

  const htLine = htScore1 !== null && htScore2 !== null
    ? `**Half Time:** ${team1} ${htScore1} – ${htScore2} ${team2}`
    : '';

  const hasStats = stats && Object.values(stats).some((v) => v !== null);
  const statRow = (label, v1, v2, unit = '') =>
    `| ${label} | ${v1 !== null && v1 !== undefined ? v1 + unit : '—'} | ${v2 !== null && v2 !== undefined ? v2 + unit : '—'} |`;

  const statsSection = hasStats ? `
## Match Stats
| Stat | ${team1} | ${team2} |
|------|----------|----------|
${statRow('Possession', stats.possession1, stats.possession2, '%')}
${statRow('Total Shots', stats.shots1, stats.shots2)}
${statRow('Shots on Target', stats.shotsOnTarget1, stats.shotsOnTarget2)}
${statRow('Passes', stats.passes1, stats.passes2)}
${statRow('Pass Accuracy', stats.passAccuracy1, stats.passAccuracy2, '%')}
${statRow('Corners', stats.corners1, stats.corners2)}
${statRow('Fouls', stats.fouls1, stats.fouls2)}
${statRow('Offsides', stats.offsides1, stats.offsides2)}
${statRow('GK Saves', stats.saves1, stats.saves2)}
*Stats via ESPN*` : `
## Match Stats
*Stats not yet available*`;

  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });

  const content = `# ${team1} vs ${team2} — Group ${group}
Date: ${dateSgt} SGT | Venue: ${venue}

## Score
${htLine ? htLine + '\n' : ''}**Full Time:** ${team1} ${score1} – ${score2} ${team2}

## Goals
${goalLines}

## Cards
${cardLines}

## Substitutions
${subLines}
${statsSection}

## AI Prediction vs Actual
- Predicted: ${pred.predicted_score || '?'} (${predWinner})
- Actual: ${score1}–${score2} (${actualWinner})
- Accuracy: ${accuracy}

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
  fetchEspnStats,
  fetchFullMatchData,
  fetchWeather,
  fetchTournamentStats,
  writeResultToObsidian,
};
