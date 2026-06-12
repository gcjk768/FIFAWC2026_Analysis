'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║     WC2026 ANALYTICS CORP — KNOWLEDGE DEPARTMENT            ║
 * ║                                                              ║
 * ║  Director: Institutional memory and reference data          ║
 * ║                                                              ║
 * ║  Staff:                                                      ║
 * ║  • Vault Manager    (obsidian-mcp)      — Obsidian knowledge ║
 * ║  • Squad Database   (squadsData)        — Player/team data   ║
 * ║  • Country Registry (countryNames)      — Name normalisation ║
 * ║  • Knockout Tracker (knockoutService)   — Bracket state      ║
 * ║  • Countdown Office (countdownService)  — Match timing       ║
 * ║  • Live Predictor   (livePrediction)    — In-match outlook   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * The Knowledge Department maintains the company's institutional
 * memory via the Obsidian vault (WC2026 folder) and reference data.
 *
 * Vault contents managed by this department:
 *   WC2026/teams/           — Team profiles (pre-loaded + updated)
 *   WC2026/predictions/     — AI prediction notes (auto-written)
 *   WC2026/match-results/   — Detailed result notes (auto-written)
 *   WC2026/head-to-head.md  — H2H records (manually maintained)
 *   WC2026/injuries.md      — Injury tracker (manually maintained)
 *   WC2026/squad-news.md    — Squad news (auto-updated)
 *   WC2026/live-standings.md — Group standings (auto-updated)
 *   WC2026/knockout-bracket.md — Bracket state (auto-updated)
 *   WC2026/calibration-report.md — Prediction accuracy (weekly)
 *
 * Usage:
 *   const knowledge = require('./departments/knowledge');
 *   const { toZh } = knowledge.countryNames;
 *   const bracket = await knowledge.getKnockoutBracket();
 */

const knockoutService  = require('../../services/knockoutService');
const countdownService = require('../../services/countdownService');
const squadsData       = require('../../services/squadsData');
const countryNames     = require('../../services/countryNames');

/**
 * Get current knockout bracket state.
 * @returns {object}
 */
function getKnockoutBracket() {
  console.log(`[KNOWLEDGE] 📋 Reading knockout bracket from vault...`);
  return knockoutService.readKnockout();
}

/**
 * Get the countdown to the next match or opening match.
 * @returns {object}
 */
function getCountdown() {
  return countdownService.getCountdown();
}

/**
 * Translate country name to Chinese.
 * @param {string} name
 * @returns {string}
 */
function translateToZh(name) {
  return countryNames.toZh(name);
}

module.exports = {
  // Department-level API
  getKnockoutBracket,
  getCountdown,
  translateToZh,
  // Direct service exports
  readKnockout:        knockoutService.readKnockout,
  writeKnockout:       knockoutService.writeKnockout,
  fetchKnockoutResults: knockoutService.fetchKnockoutResults,
  getCountdown:        countdownService.getCountdown,
  getOpeningMatchCountdown: countdownService.getOpeningMatchCountdown,
  getMatchesForDate:   countdownService.getMatchesForDate,
  toZh:                countryNames.toZh,
  squadsData,
};
