'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║     WC2026 ANALYTICS CORP — OPERATIONS DEPARTMENT           ║
 * ║                                                              ║
 * ║  Director: Scheduling, automation, and live match tracking   ║
 * ║                                                              ║
 * ║  Staff:                                                      ║
 * ║  • Scheduler        (scheduler.js)    — Cron automation      ║
 * ║  • Live Ops Desk    (liveMatchService) — Real-time polling   ║
 * ║  • Results Officer  (resultsService)  — Match result ingestion║
 * ║  • Standings Desk   (liveDataService) — Live group tables    ║
 * ║  • Live Predictions (livePredictionService) — In-game outlook║
 * ║  • Knockout Ops     (knockoutPredictionService) — Bracket mgmt║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Automated cron jobs managed by Operations:
 *   00:00 SGT — Daily countdown + fixture list
 *   08:00 SGT — Morning digest (predictions + news)
 *   Every 4h  — News fetch and broadcast
 *   3 days pre-match — Pre-match preview dispatch
 *   1 day pre-match  — Final preview + team news
 *   Every 5min (during matches) — Live result polling (4-source waterfall)
 *   Post-result — Bracket update + next round announcement
 *
 * Usage:
 *   const ops = require('./departments/operations');
 *   const results = await ops.pollForResults();
 *   await ops.onResultReceived(matchId, score);
 */

const resultsService   = require('../../services/resultsService');
const liveMatchService = require('../../services/liveMatchService');
const liveDataService  = require('../../services/liveDataService');

/**
 * Poll all live match sources for results (4-source waterfall).
 * Called every 5 minutes during active match windows.
 *
 * Sources (in priority order):
 *   1. FIFA.com API (season 285023)
 *   2. ESPN unofficial API
 *   3. Sofascore unofficial API
 *   4. football-data.org (requires API key)
 *
 * @returns {Promise<void>}
 */
async function pollForResults() {
  console.log(`[OPERATIONS] 📡 Live Ops Desk polling for match results...`);
  return liveMatchService.pollLiveMatches();
}

/**
 * Handle a confirmed match result — update standings and notify.
 * @param {object} result - { matchId, team1, team2, score1, score2, ... }
 * @returns {Promise<void>}
 */
async function onResultReceived(result) {
  console.log(`[OPERATIONS] ✅ Result received: ${result.team1} ${result.score1}-${result.score2} ${result.team2}`);
  return liveDataService.onResultReceived(result);
}

module.exports = {
  // Department-level API
  pollForResults,
  onResultReceived,
  // Direct service exports
  readResults:         resultsService.readResults,
  writeResult:         resultsService.writeResult,
  fetchTournamentStats: resultsService.fetchTournamentStats,
  readLiveStore:       liveMatchService.readLiveStore,
  onResultReceived:    liveDataService.onResultReceived,
  onKnockoutResultReceived: liveDataService.onKnockoutResultReceived,
  pollLiveMatches:     liveMatchService.pollLiveMatches,
};
