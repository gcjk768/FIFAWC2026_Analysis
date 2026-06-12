'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  STRATEGY DEPT — TACTICAL ANALYST                           ║
 * ║  Role: Analyse formation, style, and tactical matchup       ║
 * ║  ⚡ LLM CALL — Qwen call #1 in full mode                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Focused ONLY on tactical dimensions:
 *   1. Key on-field battle
 *   2. Midfield control
 *   3. Set-piece threat
 *   4. Scoring environment
 *
 * Does NOT predict a score or winner — that is the Chief Strategist's job.
 * Output feeds into the Chief Strategist alongside all other department reports.
 */

/**
 * Build the tactical analysis prompt.
 * @param {string} team1
 * @param {string} team2
 * @param {string} group
 * @param {object} s1 - enriched team stats
 * @param {object} s2 - enriched team stats
 * @param {string} vaultContext - team profile notes from Knowledge vault
 * @returns {string}
 */
function buildTacticalPrompt(team1, team2, group, s1, s2, vaultContext = '') {
  return `/no_think
You are a specialist TACTICAL ANALYST for FIFA World Cup 2026. Your only job is to analyse the tactical matchup — do NOT predict a score or winner. That is done by another analyst.

MATCH: ${team1} vs ${team2} | Group ${group} | Group Stage

${team1}: FIFA #${s1.rank} | Pre-WC: ${s1.goalsFor} gf/g, ${s1.goalsAgainst} ga/g | Form: ${s1.form}${s1.tournamentPlayed > 0 ? ` | WC2026 form: ${s1.tournamentForm} (${s1.tournamentPlayed} games)` : ''}
${team2}: FIFA #${s2.rank} | Pre-WC: ${s2.goalsFor} gf/g, ${s2.goalsAgainst} ga/g | Form: ${s2.form}${s2.tournamentPlayed > 0 ? ` | WC2026 form: ${s2.tournamentForm} (${s2.tournamentPlayed} games)` : ''}
${vaultContext ? '\nTEAM INTELLIGENCE NOTES:\n' + vaultContext : ''}
ANALYSE THESE FOUR DIMENSIONS ONLY:
1. KEY TACTICAL BATTLE — the single most important on-field contest that will decide the match
2. MIDFIELD CONTROL — which team dominates the middle of the pitch, and why
3. SET-PIECE THREAT — which team is more dangerous from corners and free kicks
4. SCORING ENVIRONMENT — will this be an open, high-scoring game or a cagey, low-scoring affair?

Respond ONLY with valid JSON, no markdown, no explanation:
{"keyBattle":"one sentence","midfieldEdge":"${team1}|${team2}|neutral","setPieceThreat":"${team1}|${team2}|neutral","scoringEnvironment":"high|medium|low","gameStyle":"open|cagey|one-sided","tacticalEdge":"${team1}|${team2}|neutral","tacticalReasoning":"2 sentences max explaining the main tactical advantage"}`;
}

/**
 * Run the Tactical Analyst — Qwen call #1 in full mode.
 * @param {string} team1
 * @param {string} team2
 * @param {string} group
 * @param {object} s1
 * @param {object} s2
 * @param {string} vaultContext
 * @param {Function} runOllama - injected from server.js
 * @returns {Promise<object>}
 */
async function runTacticalAgent(team1, team2, group, s1, s2, vaultContext, runOllama) {
  const prompt = buildTacticalPrompt(team1, team2, group, s1, s2, vaultContext);
  try {
    const result = await runOllama(prompt);
    console.log(`[STRATEGY:TACTICAL] ${team1} vs ${team2} — tactical edge: ${result.tacticalEdge} | game style: ${result.gameStyle}`);
    return result;
  } catch (err) {
    console.error('[STRATEGY:TACTICAL] Analyst failed:', err.message);
    return {
      keyBattle:        'Unable to analyse',
      midfieldEdge:     'neutral',
      setPieceThreat:   'neutral',
      scoringEnvironment: 'medium',
      gameStyle:        'open',
      tacticalEdge:     'neutral',
      tacticalReasoning: 'Tactical analysis unavailable.',
    };
  }
}

/**
 * Format tactical report as text block for injection into Chief Strategist prompt.
 * @param {object} report
 * @param {string} team1
 * @param {string} team2
 * @returns {string}
 */
function formatTacticalReport(report, team1, team2) {
  const edge = report.tacticalEdge === 'team1' ? team1
    : report.tacticalEdge === 'team2' ? team2
    : 'neutral';
  return [
    `⚽ TACTICAL ANALYST:`,
    `Key battle: ${report.keyBattle}`,
    `Midfield edge: ${report.midfieldEdge === 'team1' ? team1 : report.midfieldEdge === 'team2' ? team2 : 'neutral'}`,
    `Set-piece threat: ${report.setPieceThreat === 'team1' ? team1 : report.setPieceThreat === 'team2' ? team2 : 'neutral'}`,
    `Scoring environment: ${report.scoringEnvironment} | Game style: ${report.gameStyle}`,
    `Tactical edge: ${edge}`,
    `Reasoning: ${report.tacticalReasoning}`,
  ].join('\n');
}

module.exports = { runTacticalAgent, formatTacticalReport };
