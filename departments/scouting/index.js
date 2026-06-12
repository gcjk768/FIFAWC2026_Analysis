'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║       WC2026 ANALYTICS CORP — SCOUTING DEPARTMENT           ║
 * ║                                                              ║
 * ║  Director: Gathers pre-match intelligence from all sources   ║
 * ║                                                              ║
 * ║  Staff:                                                      ║
 * ║  • Head Scout      (headScout.js)   — Team stats + WC data  ║
 * ║  • News Desk       (newsService)    — Injuries, squad news  ║
 * ║  • Results Desk    (resultsService) — Match result tracking ║
 * ║  • Live Match Desk (liveMatchService) — Real-time data      ║
 * ║  • Weather Desk    (weatherService) — Venue conditions      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   const scouting = require('./departments/scouting');
 *   const { enriched1, enriched2 } = await scouting.gatherTeamIntelligence(team1, team2, TEAM_STATS);
 */

const { enrichTeamStats, formatTeamProfile } = require('./headScout');

/**
 * Gather pre-match team intelligence — the Scouting Department's primary brief.
 * Enriches base team stats with live WC tournament data, qualifier stats,
 * and key absences from the squad news vault note.
 *
 * @param {string} team1
 * @param {string} team2
 * @param {object} teamStats - base TEAM_STATS from server.js
 * @returns {Promise<{ enriched1: object, enriched2: object }>}
 */
async function gatherTeamIntelligence(team1, team2, teamStats) {
  console.log(`[SCOUTING] 🔍 Scouting brief opened: ${team1} vs ${team2}`);
  const result = await enrichTeamStats(team1, team2, teamStats);
  console.log(`[SCOUTING] ✓ Intelligence gathered for ${team1} and ${team2}`);
  return result;
}

module.exports = {
  // Department-level API
  gatherTeamIntelligence,
  // Direct specialist exports (for consumers that need specific functions)
  enrichTeamStats,
  formatTeamProfile,
};
