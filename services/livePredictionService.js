'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const PREDICTIONS_FILE = path.join(__dirname, '../data/predictions.json');
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = 'qwen3.6:35b';

// Average WC goals per team per 90min — used when no pre-match prediction exists
const DEFAULT_GOAL_RATE = 1.3;
const MATCH_MINUTES = 90;
const MAX_REMAINING_GOALS = 6;

// Live-stats rate adjustment: ~30% of shots on target become goals,
// trust live data more as the match progresses (capped at 60%)
const SOT_CONVERSION = 0.3;
const MAX_LIVE_WEIGHT = 0.6;
const MIN_MINUTES_FOR_STATS = 10;
const RED_CARD_OWN_FACTOR = 0.7;
const RED_CARD_OPP_FACTOR = 1.2;
const RATE_MIN = 0.2;
const RATE_MAX = 4;

// ─── PRE-MATCH PREDICTION ────────────────────────────────────────────────────

/**
 * Read the stored pre-match prediction for a matchId.
 * @param {string} matchId
 * @returns {object|null}
 */
function readPreMatchPrediction(matchId) {
  try {
    if (!fs.existsSync(PREDICTIONS_FILE)) return null;
    const all = JSON.parse(fs.readFileSync(PREDICTIONS_FILE, 'utf8'));
    return all[matchId] || null;
  } catch {
    return null;
  }
}

// ─── LIVE WIN-PROBABILITY MODEL ──────────────────────────────────────────────

/**
 * Poisson probability mass function.
 * @param {number} k
 * @param {number} lambda
 * @returns {number}
 */
function poissonPmf(k, lambda) {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

/**
 * Parse the playing minute from live data (e.g. "45'+2", "~37'", "HT").
 * @param {object} live - { status, minute }
 * @returns {number} 0–90
 */
function parseMinute(live) {
  if (live.status === 'upcoming') return 0;
  if (live.status === 'halftime') return 45;
  if (live.status === 'finished') return MATCH_MINUTES;
  const n = parseInt(String(live.minute || '').replace(/[^\d]/g, ' '), 10);
  return Number.isFinite(n) ? Math.min(n, MATCH_MINUTES) : 45;
}

/**
 * Clamp an expected goal rate to a sane per-90 range.
 * @param {number} rate
 * @returns {number}
 */
function clampRate(rate) {
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rate));
}

/**
 * Blend pre-match expected goal rates with live attacking output.
 * Shots on target are the strongest in-match scoring signal; red cards
 * suppress the short-handed team's rate and boost the opponent's.
 * @param {number} rate1 - pre-match per-90 rate for team1
 * @param {number} rate2 - pre-match per-90 rate for team2
 * @param {object} live - { redCards1, redCards2 }
 * @param {object|null} stats - live ESPN stats (shotsOnTarget1/2)
 * @param {number} minute
 * @returns {number[]} [adjustedRate1, adjustedRate2]
 */
function adjustRatesWithStats(rate1, rate2, live, stats, minute) {
  let r1 = rate1;
  let r2 = rate2;

  if (stats && minute >= MIN_MINUTES_FOR_STATS) {
    const sot1 = parseFloat(stats.shotsOnTarget1);
    const sot2 = parseFloat(stats.shotsOnTarget2);
    const w = Math.min(MAX_LIVE_WEIGHT, (minute / MATCH_MINUTES) * 0.9);
    if (Number.isFinite(sot1)) r1 = (1 - w) * r1 + w * (sot1 / minute) * MATCH_MINUTES * SOT_CONVERSION;
    if (Number.isFinite(sot2)) r2 = (1 - w) * r2 + w * (sot2 / minute) * MATCH_MINUTES * SOT_CONVERSION;
  }

  const red1 = live.redCards1 || 0;
  const red2 = live.redCards2 || 0;
  r1 *= Math.pow(RED_CARD_OWN_FACTOR, red1) * Math.pow(RED_CARD_OPP_FACTOR, red2);
  r2 *= Math.pow(RED_CARD_OWN_FACTOR, red2) * Math.pow(RED_CARD_OPP_FACTOR, red1);

  return [clampRate(r1), clampRate(r2)];
}

/**
 * Compute in-match outcome probabilities from the current score and time
 * remaining, with expected goal rates seeded from the pre-match prediction
 * and adjusted by live stats (shots on target momentum, red cards).
 * @param {object} fixture - { team1, team2 }
 * @param {object} live - { status, minute, score1, score2, redCards1, redCards2 }
 * @param {object|null} preMatch - stored pre-match prediction
 * @param {object|null} [stats] - live ESPN match stats
 * @returns {object} { winProb1, drawProb, winProb2, favored, predictedFinal, minute }
 */
function computeLiveOutlook(fixture, live, preMatch, stats = null) {
  const minute = parseMinute(live);
  const remaining = Math.max(0, MATCH_MINUTES - minute);

  // Per-team expected goals for the remaining time
  let rate1 = DEFAULT_GOAL_RATE;
  let rate2 = DEFAULT_GOAL_RATE;
  const predScore = (preMatch?.predicted_score || '').match(/^(\d+)-(\d+)$/);
  if (predScore) {
    rate1 = Math.max(0.3, parseInt(predScore[1], 10));
    rate2 = Math.max(0.3, parseInt(predScore[2], 10));
  }
  [rate1, rate2] = adjustRatesWithStats(rate1, rate2, live, stats, minute);
  const lam1 = (rate1 * remaining) / MATCH_MINUTES;
  const lam2 = (rate2 * remaining) / MATCH_MINUTES;

  const diff = (live.score1 || 0) - (live.score2 || 0);
  let win1 = 0;
  let draw = 0;
  let win2 = 0;

  for (let a = 0; a <= MAX_REMAINING_GOALS; a++) {
    for (let b = 0; b <= MAX_REMAINING_GOALS; b++) {
      const p = poissonPmf(a, lam1) * poissonPmf(b, lam2);
      const finalDiff = diff + a - b;
      if (finalDiff > 0) win1 += p;
      else if (finalDiff < 0) win2 += p;
      else draw += p;
    }
  }

  const total = win1 + draw + win2 || 1;
  const winProb1 = Math.round((win1 / total) * 100);
  const winProb2 = Math.round((win2 / total) * 100);
  const drawProb = Math.max(0, 100 - winProb1 - winProb2);

  const favored = winProb1 > winProb2 && winProb1 > drawProb ? fixture.team1
    : winProb2 > winProb1 && winProb2 > drawProb ? fixture.team2
    : 'draw';

  const predictedFinal = `${(live.score1 || 0) + Math.round(lam1)}-${(live.score2 || 0) + Math.round(lam2)}`;

  return { winProb1, drawProb, winProb2, favored, predictedFinal, minute };
}

// ─── QWEN LIVE RE-ANALYSIS ───────────────────────────────────────────────────

/**
 * Format the live ESPN stats as a prompt block for Qwen.
 * @param {object} fixture - { team1, team2 }
 * @param {object} live - { redCards1, redCards2 }
 * @param {object|null} stats
 * @returns {string} stats block or empty string
 */
function buildStatsBlock(fixture, live, stats) {
  if (!stats) return '';
  const { team1, team2 } = fixture;
  const row = (label, v1, v2, suffix = '') => (
    v1 != null && v2 != null ? `- ${label}: ${team1} ${v1}${suffix} | ${team2} ${v2}${suffix}` : null
  );
  const rows = [
    row('Possession', stats.possession1, stats.possession2, '%'),
    row('Shots (on target)', `${stats.shots1 ?? '?'} (${stats.shotsOnTarget1 ?? '?'})`,
      `${stats.shots2 ?? '?'} (${stats.shotsOnTarget2 ?? '?'})`),
    row('Corners', stats.corners1, stats.corners2),
    row('Saves', stats.saves1, stats.saves2),
    (live.redCards1 || live.redCards2)
      ? `- RED CARDS: ${team1} ${live.redCards1 || 0} | ${team2} ${live.redCards2 || 0}` : null,
  ].filter(Boolean);
  return rows.length ? `\nLIVE MATCH STATS:\n${rows.join('\n')}\n` : '';
}

/**
 * Build a compact live re-analysis prompt for Qwen.
 * @param {object} fixture
 * @param {object} live
 * @param {object} outlook
 * @param {object|null} preMatch
 * @param {object|null} [stats] - live ESPN match stats
 * @returns {string}
 */
function buildLivePrompt(fixture, live, outlook, preMatch, stats = null) {
  const { team1, team2, group } = fixture;
  return `/no_think
You are an expert football analyst. A FIFA World Cup 2026 group match is IN PROGRESS.

MATCH: ${team1} vs ${team2} (Group ${group})
CURRENT SCORE: ${team1} ${live.score1}:${live.score2} ${team2}
MINUTE: ${outlook.minute}' (${live.status})
${preMatch ? `PRE-MATCH PREDICTION: ${preMatch.winner} to win, ${preMatch.predicted_score}, confidence ${preMatch.confidence}%` : ''}
MODEL WIN PROBABILITIES NOW: ${team1} ${outlook.winProb1}% | draw ${outlook.drawProb}% | ${team2} ${outlook.winProb2}%
${buildStatsBlock(fixture, live, stats)}
INSTRUCTIONS:
- Update the predicted final outcome given the current score and time remaining
- Weigh the live stats: shots on target and possession show who has momentum
- A red card is a major swing — the short-handed team rarely recovers
- Group stage: draws are valid, no extra time
- Be realistic: a 2-goal lead after 75' is rarely overturned

Respond ONLY with valid JSON, no markdown, no explanation:
{"winner":"${team1}|${team2}|draw","confidence":75,"predicted_score":"2-1","analysis_summary":"1-2 sentence updated in-match read."}`;
}

/**
 * Call Qwen via Ollama for an updated in-match prediction.
 * Never throws — returns null if Ollama is offline or the JSON is invalid.
 * @param {object} fixture
 * @param {object} live
 * @param {object} outlook
 * @param {object|null} [stats] - live ESPN match stats
 * @returns {Promise<object|null>}
 */
async function refreshLiveAnalysis(fixture, live, outlook, stats = null) {
  try {
    const preMatch = readPreMatchPrediction(fixture.matchId);
    const prompt = buildLivePrompt(fixture, live, outlook, preMatch, stats);

    // keep_alive keeps the model warm across the 5-min live refresh cycle;
    // the long timeout covers a cold model load on the first in-match call
    const resp = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, keep_alive: '30m' }),
      timeout: 300000,
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const raw = (data.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.winner || !parsed.predicted_score) return null;

    console.log(`[LIVE] Qwen re-analysis (${fixture.matchId}): ${parsed.winner} ${parsed.predicted_score} @${outlook.minute}'`);
    return { ...parsed, atMinute: outlook.minute, updatedAt: new Date().toISOString() };
  } catch (err) {
    console.error(`[LIVE] Qwen re-analysis error (${fixture.matchId}):`, err.message);
    return null;
  }
}

module.exports = {
  readPreMatchPrediction,
  computeLiveOutlook,
  refreshLiveAnalysis,
};
