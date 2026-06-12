'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║      WC2026 ANALYTICS CORP — ANALYTICS DEPARTMENT           ║
 * ║                                                              ║
 * ║  Director: Pure mathematics — no LLM calls, just numbers    ║
 * ║                                                              ║
 * ║  Staff:                                                      ║
 * ║  • Quant Model     (quantModel.js)      — Poisson xG model  ║
 * ║  • Calibration Desk (calibrationDesk.js) — Accuracy tracking║
 * ║  • Standings Desk  (liveDataService)    — Live group tables ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   const analytics = require('./departments/analytics');
 *   const statReport = analytics.runModel(s1, s2, opts);
 *   const note = await analytics.getCalibrationNote();
 */

const { runStatisticalModel, formatStatReport } = require('./quantModel');
const { computeCalibration, writeCalibrationToObsidian, fetchCalibrationNote } = require('./calibrationDesk');

/**
 * Run the full Poisson xG statistical model for a matchup.
 * Returns win probabilities, expected goals, and top scorelines.
 *
 * @param {object} s1 - enriched team 1 stats
 * @param {object} s2 - enriched team 2 stats
 * @param {object} [opts] - { team1HomeAdvantage, team2HomeAdvantage }
 * @returns {object} statistical report
 */
function runModel(s1, s2, opts = {}) {
  console.log(`[ANALYTICS] 📐 Running Poisson xG model...`);
  return runStatisticalModel(s1, s2, opts);
}

/**
 * Retrieve calibration note to inject into Qwen prompts.
 * Tells the AI about past prediction biases so it self-corrects.
 *
 * @returns {Promise<string>}
 */
async function getCalibrationNote() {
  console.log(`[ANALYTICS] 📊 Fetching calibration note from vault...`);
  return fetchCalibrationNote();
}

module.exports = {
  // Department-level API
  runModel,
  getCalibrationNote,
  // Direct specialist exports
  runStatisticalModel,
  formatStatReport,
  computeCalibration,
  writeCalibrationToObsidian,
  fetchCalibrationNote,
};
