'use strict';

/**
 * Calibration Agent
 *
 * Compares past predictions against real results to:
 *   1. Track overall outcome accuracy
 *   2. Detect per-team bias (are we over/under-rating certain teams?)
 *   3. Measure confidence calibration (when we say 80%, do we win 80%?)
 *   4. Write a calibration note to Obsidian so future Consensus calls know our blind spots
 *
 * Run this after each result comes in, and on demand via GET /api/calibration.
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const PREDICTIONS_FILE = path.join(__dirname, '../../data/predictions.json');
const RESULTS_FILE     = path.join(__dirname, '../../data/match-results.json');
const OBSIDIAN_MCP     = 'http://localhost:3002';

// ─── FILE HELPERS ─────────────────────────────────────────────────────────────

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

// ─── CORE CALIBRATION ─────────────────────────────────────────────────────────

/**
 * Compute calibration stats by comparing predictions to real results.
 * @returns {object} Full calibration report
 */
function computeCalibration() {
  const predictions = readJson(PREDICTIONS_FILE);
  const results     = readJson(RESULTS_FILE);

  const compared = [];
  const teamBias = {}; // teamName → { predicted_wins, actual_wins, appearances }
  const confidenceBuckets = {}; // "50-59" → { total, correct }

  for (const [matchId, pred] of Object.entries(predictions)) {
    const result = results[matchId];
    if (!result || result.score1 === undefined || result.score2 === undefined) continue;

    const { team1, team2, winner: predWinner, confidence, predicted_score } = pred;
    const { score1, score2 } = result;

    // Actual outcome
    const actualWinner = score1 > score2 ? team1 : score2 > score1 ? team2 : 'draw';
    const actualScore  = `${score1}-${score2}`;

    const outcomeCorrect = predWinner === actualWinner;
    const scoreCorrect   = predicted_score === actualScore;
    const goalDiff       = Math.abs(
      (parseInt((predicted_score || '0-0').split('-')[0]) - score1) +
      (parseInt((predicted_score || '0-0').split('-')[1]) - score2)
    );

    compared.push({ matchId, team1, team2, predWinner, actualWinner, confidence, outcomeCorrect, scoreCorrect, goalDiff });

    // Per-team bias tracking
    for (const team of [team1, team2]) {
      if (!teamBias[team]) teamBias[team] = { predicted_wins: 0, actual_wins: 0, appearances: 0, correct: 0 };
      teamBias[team].appearances++;
      if (predWinner === team) teamBias[team].predicted_wins++;
      if (actualWinner === team) teamBias[team].actual_wins++;
      if (outcomeCorrect) teamBias[team].correct++;
    }

    // Confidence bucket
    const bucket = `${Math.floor((confidence || 50) / 10) * 10}-${Math.floor((confidence || 50) / 10) * 10 + 9}`;
    if (!confidenceBuckets[bucket]) confidenceBuckets[bucket] = { total: 0, correct: 0 };
    confidenceBuckets[bucket].total++;
    if (outcomeCorrect) confidenceBuckets[bucket].correct++;
  }

  if (compared.length === 0) {
    return { totalCompared: 0, message: 'No results available for calibration yet.' };
  }

  const totalCompared   = compared.length;
  const correctOutcomes = compared.filter((c) => c.outcomeCorrect).length;
  const correctScores   = compared.filter((c) => c.scoreCorrect).length;
  const avgGoalDiff     = (compared.reduce((s, c) => s + c.goalDiff, 0) / totalCompared).toFixed(2);
  const outcomeAccuracy = ((correctOutcomes / totalCompared) * 100).toFixed(1);
  const scoreAccuracy   = ((correctScores   / totalCompared) * 100).toFixed(1);

  // Avg confidence on correct vs incorrect picks
  const correctConf   = compared.filter((c) => c.outcomeCorrect).map((c) => c.confidence);
  const incorrectConf = compared.filter((c) => !c.outcomeCorrect).map((c) => c.confidence);
  const avgCorrectConf   = correctConf.length   ? (correctConf.reduce((s, v) => s + v, 0)   / correctConf.length).toFixed(1)   : 'N/A';
  const avgIncorrectConf = incorrectConf.length  ? (incorrectConf.reduce((s, v) => s + v, 0) / incorrectConf.length).toFixed(1) : 'N/A';

  // Detect overrated teams (we predicted more wins than they got)
  const overrated  = Object.entries(teamBias)
    .filter(([, b]) => b.appearances >= 2 && b.predicted_wins > b.actual_wins + 1)
    .sort((a, b) => (b[1].predicted_wins - b[1].actual_wins) - (a[1].predicted_wins - a[1].actual_wins))
    .slice(0, 3)
    .map(([team, b]) => `${team} (pred ${b.predicted_wins}W, actual ${b.actual_wins}W)`);

  const underrated = Object.entries(teamBias)
    .filter(([, b]) => b.appearances >= 2 && b.actual_wins > b.predicted_wins + 1)
    .sort((a, b) => (b[1].actual_wins - b[1].predicted_wins) - (a[1].actual_wins - a[1].predicted_wins))
    .slice(0, 3)
    .map(([team, b]) => `${team} (pred ${b.predicted_wins}W, actual ${b.actual_wins}W)`);

  // Calibration check: are confidence levels accurate?
  const calibrationCheck = Object.entries(confidenceBuckets)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([bucket, { total, correct }]) => ({
      bucket,
      total,
      accuracy: ((correct / total) * 100).toFixed(1) + '%',
      calibrated: Math.abs((correct / total) * 100 - parseInt(bucket)) < 15,
    }));

  // Build a short calibration note for injection into Consensus prompts
  const calibrationNote = buildCalibrationNote(outcomeAccuracy, overrated, underrated, avgGoalDiff);

  return {
    totalCompared,
    outcomeAccuracy: outcomeAccuracy + '%',
    scoreAccuracy:   scoreAccuracy   + '%',
    avgGoalDiff,
    avgConfidenceOnCorrect:   avgCorrectConf,
    avgConfidenceOnIncorrect: avgIncorrectConf,
    overrated,
    underrated,
    calibrationCheck,
    teamBias,
    calibrationNote,
  };
}

/**
 * Build a short text note for injection into future Consensus prompts.
 * @param {string} accuracy
 * @param {string[]} overrated
 * @param {string[]} underrated
 * @param {string} avgGoalDiff
 * @returns {string}
 */
function buildCalibrationNote(accuracy, overrated, underrated, avgGoalDiff) {
  const parts = [`Our past predictions: ${accuracy}% outcome accuracy, avg goal error: ${avgGoalDiff}`];
  if (overrated.length)  parts.push(`We tend to OVERRATE: ${overrated.join(', ')} — reduce confidence on these`);
  if (underrated.length) parts.push(`We tend to UNDERRATE: ${underrated.join(', ')} — increase confidence against these`);
  return parts.join('. ');
}

/**
 * Write the calibration report to Obsidian vault.
 * @param {object} report
 * @returns {Promise<void>}
 */
async function writeCalibrationToObsidian(report) {
  if (!report.totalCompared) return;

  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  const lines = [
    `# Calibration Report`,
    `*Updated: ${now} SGT*`,
    ``,
    `## Overall Accuracy`,
    `- Matches compared: ${report.totalCompared}`,
    `- Outcome accuracy: ${report.outcomeAccuracy}`,
    `- Score accuracy: ${report.scoreAccuracy}`,
    `- Avg goal difference from prediction: ${report.avgGoalDiff}`,
    `- Avg confidence when CORRECT: ${report.avgConfidenceOnCorrect}%`,
    `- Avg confidence when WRONG: ${report.avgConfidenceOnIncorrect}%`,
    ``,
    `## Team Bias`,
    `### Overrated (we predicted more wins than they got)`,
    ...(report.overrated.length ? report.overrated.map((t) => `- ${t}`) : ['- None detected']),
    ``,
    `### Underrated (they won more than we predicted)`,
    ...(report.underrated.length ? report.underrated.map((t) => `- ${t}`) : ['- None detected']),
    ``,
    `## Confidence Calibration`,
    `| Confidence Range | Matches | Actual Accuracy | Calibrated? |`,
    `|-----------------|---------|-----------------|-------------|`,
    ...(report.calibrationCheck || []).map((c) =>
      `| ${c.bucket}% | ${c.total} | ${c.accuracy} | ${c.calibrated ? '✅' : '❌'} |`
    ),
    ``,
    `## Note for Future Predictions`,
    `> ${report.calibrationNote}`,
  ];

  try {
    await fetch(`${OBSIDIAN_MCP}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'WC2026/calibration-report.md',
        content: lines.join('\n'),
      }),
      timeout: 5000,
    });
    console.log('[CALIBRATION] Report written to Obsidian vault');
  } catch (err) {
    console.error('[CALIBRATION] Obsidian write failed (non-fatal):', err.message);
  }
}

/**
 * Fetch the current calibration note from Obsidian for injection into prompts.
 * Returns a short string or empty string if unavailable.
 * @returns {Promise<string>}
 */
async function fetchCalibrationNote() {
  try {
    const resp = await fetch(
      `${OBSIDIAN_MCP}/read/${encodeURIComponent('WC2026/calibration-report.md')}`,
      { timeout: 3000 }
    );
    const data = await resp.json();
    if (!data.content) return '';
    // Extract just the "Note for Future Predictions" line
    const match = data.content.match(/>\s*(.+)/);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

module.exports = { computeCalibration, writeCalibrationToObsidian, fetchCalibrationNote };
