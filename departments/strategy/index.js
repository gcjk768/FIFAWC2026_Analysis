'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║      WC2026 ANALYTICS CORP — STRATEGY DEPARTMENT            ║
 * ║                                                              ║
 * ║  Director: AI-powered analysis — all LLM calls live here    ║
 * ║                                                              ║
 * ║  Staff:                                                      ║
 * ║  • Tactician        (tactician.js)       — Tactical matchup ║
 * ║  • Club Historian   (historian.js)       — H2H records      ║
 * ║  • Psychologist     (psychologist.js)    — Motivation/press ║
 * ║  • Risk Analyst     (riskAnalyst.js)     — Devil's advocate ║
 * ║  • Chief Strategist (chiefStrategist.js) — Final synthesis  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Only Tactician and Chief Strategist make LLM calls.
 * Historian and Psychologist are code-computed — no Qwen needed.
 *
 * Usage:
 *   const strategy = require('./departments/strategy');
 *   const tactical = await strategy.getTacticalReport(team1, team2, group, s1, s2, ctx, runOllama);
 *   const prediction = await strategy.getFinalPrediction(team1, team2, group, reports, runOllama, fmt);
 */

const { runTacticalAgent, formatTacticalReport } = require('./tactician');
const { runHistorianAgent, formatHistorianReport } = require('./historian');
const { runPsychologistAgent, formatPsychReport } = require('./psychologist');
const { runDevilsAdvocateAgent, formatDevilReport } = require('./riskAnalyst');
const { runConsensusAgent, buildQualifierBlock } = require('./chiefStrategist');

/**
 * Get tactical analysis from the Tactical Analyst (Qwen call #1).
 * Covers: key battle, midfield control, set pieces, scoring environment.
 */
async function getTacticalReport(team1, team2, group, s1, s2, vaultContext, runOllama) {
  console.log(`[STRATEGY] 🎯 Tactical Analyst briefing: ${team1} vs ${team2}...`);
  return runTacticalAgent(team1, team2, group, s1, s2, vaultContext, runOllama);
}

/**
 * Get historical H2H analysis from the Club Historian (code-only, no Qwen).
 */
function getHistoricalReport(team1, team2, h2hRawContent) {
  console.log(`[STRATEGY] 📖 Historian filing H2H report: ${team1} vs ${team2}...`);
  return runHistorianAgent(team1, team2, h2hRawContent);
}

/**
 * Get psychological + motivation analysis from the Psychologist (code-only, no Qwen).
 */
async function getPsychReport(team1, team2, group, matchday, venue, s1, s2) {
  console.log(`[STRATEGY] 🧠 Psychologist filing motivation report: ${team1} vs ${team2}...`);
  return runPsychologistAgent(team1, team2, group, matchday, venue, s1, s2);
}

/**
 * Get final synthesised prediction from Chief Strategist (Qwen call #2).
 * Includes embedded Devil's Advocate self-challenge step.
 */
async function getFinalPrediction(team1, team2, group, reports, runOllama, formatters) {
  console.log(`[STRATEGY] 🏆 Chief Strategist synthesising final prediction: ${team1} vs ${team2}...`);
  return runConsensusAgent(team1, team2, group, reports, runOllama, formatters);
}

module.exports = {
  // Department-level API
  getTacticalReport,
  getHistoricalReport,
  getPsychReport,
  getFinalPrediction,
  // Direct specialist exports
  runTacticalAgent,
  formatTacticalReport,
  runHistorianAgent,
  formatHistorianReport,
  runPsychologistAgent,
  formatPsychReport,
  runDevilsAdvocateAgent,
  formatDevilReport,
  runConsensusAgent,
  buildQualifierBlock,
};
