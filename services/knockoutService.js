'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const KNOCKOUT_FILE = path.join(__dirname, '../data/knockout.json');

// football-data.org stage codes for WC2026
const KNOCKOUT_STAGES = ['LAST_32', 'ROUND_OF_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL'];

// Map API stage codes → our round keys
const STAGE_MAP = {
  LAST_32:        'roundOf32',
  ROUND_OF_32:    'roundOf32',
  ROUND_OF_16:    'roundOf16',
  QUARTER_FINALS: 'quarterFinals',
  SEMI_FINALS:    'semiFinals',
  THIRD_PLACE:    'thirdPlace',
  FINAL:          'final',
};

// ─── FILE HELPERS ─────────────────────────────────────────────────────────────

/**
 * Read knockout.json safely.
 * @returns {object}
 */
function readKnockout() {
  try {
    if (!fs.existsSync(KNOCKOUT_FILE)) {
      return { lastUpdated: null, champion: null, rounds: { roundOf32: [], roundOf16: [], quarterFinals: [], semiFinals: [], thirdPlace: null, final: null } };
    }
    return JSON.parse(fs.readFileSync(KNOCKOUT_FILE, 'utf8'));
  } catch {
    return { lastUpdated: null, champion: null, rounds: { roundOf32: [], roundOf16: [], quarterFinals: [], semiFinals: [], thirdPlace: null, final: null } };
  }
}

/**
 * Write knockout.json atomically.
 * @param {object} data
 */
function writeKnockout(data) {
  const tmp = KNOCKOUT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, KNOCKOUT_FILE);
}

// ─── API FETCH ────────────────────────────────────────────────────────────────

/**
 * Normalise an API match object into our internal format.
 * @param {object} m - match from football-data.org
 * @returns {object}
 */
function normaliseMatch(m) {
  const kickoff = m.utcDate ? new Date(m.utcDate) : null;
  const dateSgt = kickoff ? kickoff.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }) : 'TBD';
  const timeSgt = kickoff ? kickoff.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false }) : 'TBD';

  const team1 = m.homeTeam?.name || 'TBD';
  const team2 = m.awayTeam?.name || 'TBD';
  const score1 = m.score?.fullTime?.home ?? null;
  const score2 = m.score?.fullTime?.away ?? null;
  const status = m.status || 'SCHEDULED';

  let winner = null;
  if (status === 'FINISHED' && score1 !== null && score2 !== null) {
    winner = score1 > score2 ? team1 : score2 > score1 ? team2 : 'draw';
    // Knockout has no draw — check penalties
    if (winner === 'draw' && m.score?.penalties) {
      winner = m.score.penalties.home > m.score.penalties.away ? team1 : team2;
    }
  }

  return {
    apiId: m.id,
    team1,
    team2,
    dateSgt,
    timeSgt,
    venue: m.venue || 'TBD',
    status,
    score1,
    score2,
    winner,
    penalties: m.score?.penalties || null,
    stage: m.stage,
  };
}

/**
 * Fetch all knockout stage matches from football-data.org and update knockout.json.
 * @returns {Promise<boolean>} true if any update was made
 */
async function fetchKnockoutResults() {
  if (!FOOTBALL_API_KEY) {
    console.log('[KNOCKOUT] No FOOTBALL_API_KEY — skipping knockout fetch');
    return false;
  }

  try {
    const resp = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': FOOTBALL_API_KEY },
      timeout: 15000,
    });

    if (!resp.ok) {
      console.error(`[KNOCKOUT] API error: HTTP ${resp.status}`);
      return false;
    }

    const data = await resp.json();
    if (!data.matches) return false;

    // Filter to knockout stage matches only
    const knockoutMatches = data.matches.filter((m) => STAGE_MAP[m.stage]);
    if (knockoutMatches.length === 0) {
      console.log('[KNOCKOUT] No knockout matches in API yet — group stage still in progress');
      return false;
    }

    const current = readKnockout();
    let updated = false;

    // Group by stage
    const byStage = {};
    for (const m of knockoutMatches) {
      const key = STAGE_MAP[m.stage];
      if (!byStage[key]) byStage[key] = [];
      byStage[key].push(normaliseMatch(m));
    }

    // Update each round
    for (const [key, matches] of Object.entries(byStage)) {
      if (key === 'final' || key === 'thirdPlace') {
        current.rounds[key] = matches[0] || null;
      } else {
        current.rounds[key] = matches;
      }
      updated = true;
    }

    // Set champion when final is done
    if (current.rounds.final && current.rounds.final.winner && current.rounds.final.winner !== 'draw') {
      current.champion = current.rounds.final.winner;
    }

    if (updated) {
      current.lastUpdated = new Date().toISOString();
      writeKnockout(current);
      console.log(`[KNOCKOUT] Updated — ${knockoutMatches.length} knockout matches stored`);
    }

    return updated;
  } catch (err) {
    console.error('[KNOCKOUT] fetchKnockoutResults error:', err.message);
    return false;
  }
}

// ─── DISPLAY HELPERS ──────────────────────────────────────────────────────────

/**
 * Format a single knockout match for display.
 * @param {object} m
 * @returns {string}
 */
function formatKnockoutMatch(m) {
  if (!m) return '• TBD vs TBD';
  if (m.status === 'FINISHED') {
    const pen = m.penalties ? ` (pen ${m.penalties.home}–${m.penalties.away})` : '';
    return `✅ *${m.team1}* ${m.score1}–${m.score2} *${m.team2}*${pen}`;
  }
  if (m.team1 === 'TBD' && m.team2 === 'TBD') return `🔜 TBD vs TBD`;
  return `🔜 ${m.team1} vs ${m.team2} \\| ${m.dateSgt} ${m.timeSgt} SGT`;
}

/**
 * Get a summary of which round the tournament is currently in.
 * @returns {string}
 */
function getCurrentRound() {
  const { rounds, champion } = readKnockout();
  if (champion) return `champion`;
  if (rounds.final && rounds.final.status === 'FINISHED') return 'final';
  if (rounds.semiFinals && rounds.semiFinals.some((m) => m.status !== 'FINISHED')) return 'semiFinals';
  if (rounds.quarterFinals && rounds.quarterFinals.some((m) => m.status !== 'FINISHED')) return 'quarterFinals';
  if (rounds.roundOf16 && rounds.roundOf16.some((m) => m.status !== 'FINISHED')) return 'roundOf16';
  if (rounds.roundOf32 && rounds.roundOf32.length > 0) return 'roundOf32';
  return 'groupStage';
}

module.exports = {
  readKnockout,
  fetchKnockoutResults,
  formatKnockoutMatch,
  getCurrentRound,
};
