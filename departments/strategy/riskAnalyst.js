'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  STRATEGY DEPT — RISK ANALYST (Devil's Advocate)            ║
 * ║  Role: Actively challenges the draft consensus              ║
 * ║  ⚡ LLM CALL when used standalone                           ║
 * ║  (Embedded in Chief Strategist prompt in current pipeline)  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * This is what professional betting analysts do — always ask
 * "what if we're wrong?" before locking in a prediction.
 *
 * Finds the strongest case for the underdog winning, quantifies
 * upset probability, and recommends confidence adjustments.
 *
 * Note: In the current 2-Qwen pipeline, this logic is embedded
 * inside the Chief Strategist's prompt as a self-challenge step,
 * saving one round-trip. This file is kept for standalone use.
 */

/**
 * Determine the draft favourite from all department reports.
 * @param {string} team1
 * @param {string} team2
 * @param {object} tacticalReport
 * @param {object} historianReport
 * @param {object} psychReport
 * @param {object} statReport
 * @returns {{ favourite: string, underdog: string, draftConfidence: number }}
 */
function deriveDraftFavourite(team1, team2, tacticalReport, historianReport, psychReport, statReport) {
  let votes1 = 0, votes2 = 0;

  if (statReport.statWinner === 'team1') votes1 += 2;
  else if (statReport.statWinner === 'team2') votes2 += 2;

  if (tacticalReport.tacticalEdge === team1 || tacticalReport.tacticalEdge === 'team1') votes1 += 1;
  else if (tacticalReport.tacticalEdge === team2 || tacticalReport.tacticalEdge === 'team2') votes2 += 1;

  const t1Key = team1.replace(/\s+/g, '_');
  if (historianReport.h2hVerdict === `favors_${t1Key}`) votes1 += 1;
  else if (historianReport.h2hVerdict && historianReport.h2hVerdict.startsWith('favors_') && !historianReport.h2hVerdict.includes(t1Key)) votes2 += 1;

  if (psychReport.psychologicalEdge === team1) votes1 += 1;
  else if (psychReport.psychologicalEdge === team2) votes2 += 1;

  const favourite       = votes1 >= votes2 ? team1 : team2;
  const underdog        = favourite === team1 ? team2 : team1;
  const draftConfidence = statReport.statConfidence || 65;

  return { favourite, underdog, draftConfidence };
}

/**
 * Build the devil's advocate challenge prompt.
 */
function buildDevilsPrompt(team1, team2, favourite, underdog, draftConfidence, tacticalSummary, psychSummary, statReport) {
  return `/no_think
You are the DEVIL'S ADVOCATE ANALYST for FIFA World Cup 2026. The other analysts currently favour ${favourite} with ${draftConfidence}% confidence. Your job is to find the STRONGEST case for why ${underdog} could win or draw.

MATCH: ${team1} vs ${team2}
DRAFT CONSENSUS: ${favourite} wins (${draftConfidence}% confidence)

STATISTICAL BASELINE:
${team1} xG: ${statReport.xG1} | ${team2} xG: ${statReport.xG2}
Win probs: ${team1} ${(statReport.winProb1 * 100).toFixed(1)}% | Draw ${(statReport.drawProb * 100).toFixed(1)}% | ${team2} ${(statReport.winProb2 * 100).toFixed(1)}%

SPECIALIST NOTES:
${tacticalSummary}
${psychSummary}

YOUR TASK — argue for ${underdog}:
1. What is the ONE tactical weapon ${underdog} has that could neutralise ${favourite}'s advantage?
2. Is ${favourite} likely to be overconfident or rotating players?
3. Could a single set-piece, red card, or chaotic game style level the playing field?
4. What is the realistic upset scoreline?
5. How likely (%) is this upset scenario?

Be honest — if the favourite is genuinely dominant, say so (low upset probability). But still find their vulnerability.

Respond ONLY with valid JSON, no markdown:
{"upsetProbability":22,"upsetScenario":"one sentence describing how ${underdog} wins","underdogWeapon":"one specific tactical advantage","favouriteVulnerability":"one specific weakness","upsetScore":"e.g. 1-0 or 2-1","recommendAdjustment":true,"adjustedConfidence":68,"devilReasoning":"2 sentences"}`;
}

/**
 * Run the Risk Analyst — standalone LLM call.
 * (In current pipeline this is embedded in the Chief Strategist prompt.)
 * @param {string} team1
 * @param {string} team2
 * @param {object} tacticalReport
 * @param {object} historianReport
 * @param {object} psychReport
 * @param {object} statReport
 * @param {Function} runOllama
 * @returns {Promise<object>}
 */
async function runDevilsAdvocateAgent(team1, team2, tacticalReport, historianReport, psychReport, statReport, runOllama) {
  const { favourite, underdog, draftConfidence } = deriveDraftFavourite(
    team1, team2, tacticalReport, historianReport, psychReport, statReport
  );

  const tacticalSummary = `Tactical edge: ${tacticalReport.tacticalEdge} | Game style: ${tacticalReport.gameStyle} | ${tacticalReport.keyBattle}`;
  const psychSummary    = `${team1} motivation: ${psychReport.team1Motivation} | ${team2} motivation: ${psychReport.team2Motivation} | Edge: ${psychReport.psychologicalEdge}`;

  const prompt = buildDevilsPrompt(team1, team2, favourite, underdog, draftConfidence, tacticalSummary, psychSummary, statReport);

  try {
    const result = await runOllama(prompt);
    console.log(`[STRATEGY:RISK] ${team1} vs ${team2} — upset prob: ${result.upsetProbability}% | adjusted confidence: ${result.adjustedConfidence}`);
    return { ...result, favourite, underdog };
  } catch (err) {
    console.error('[STRATEGY:RISK] Risk Analyst failed:', err.message);
    return {
      upsetProbability:        20,
      upsetScenario:           'Analysis unavailable.',
      underdogWeapon:          'Unknown',
      favouriteVulnerability:  'Unknown',
      upsetScore:              '1-0',
      recommendAdjustment:     false,
      adjustedConfidence:      draftConfidence,
      devilReasoning:          "Risk analysis unavailable.",
      favourite,
      underdog,
    };
  }
}

/**
 * Format risk analyst report as text block.
 * @param {object} report
 * @returns {string}
 */
function formatDevilReport(report) {
  return [
    `⚠️ RISK ANALYST (case for ${report.underdog}):`,
    `Upset probability: ${report.upsetProbability}%`,
    `Upset scenario: ${report.upsetScenario}`,
    `${report.underdog}'s weapon: ${report.underdogWeapon}`,
    `${report.favourite}'s vulnerability: ${report.favouriteVulnerability}`,
    `Upset score: ${report.upsetScore}`,
    report.recommendAdjustment
      ? `⬇️ Recommends lowering confidence to ${report.adjustedConfidence}%`
      : `✅ Draft confidence stands`,
    `Reasoning: ${report.devilReasoning}`,
  ].join('\n');
}

module.exports = { runDevilsAdvocateAgent, formatDevilReport };
