'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ANALYTICS DEPT — QUANT MODEL                                ║
 * ║  Role: Dixon-Coles Poisson xG model — pure mathematics       ║
 * ║  No LLM call. Anchors the CEO's final prediction.            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Computes expected goals (xG) for both teams using a simplified
 * Dixon-Coles model, then runs Poisson distribution to estimate
 * win/draw/loss probabilities and most-likely scorelines.
 *
 * This statistical baseline prevents the Strategy Department from
 * straying too far from objective probability without strong reason.
 */

const LEAGUE_AVG = 1.35; // International football baseline

/**
 * Compute Poisson probability of exactly k events given mean lambda.
 * @param {number} k
 * @param {number} lambda
 * @returns {number}
 */
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Run Poisson simulation across all scorelines up to maxGoals per team.
 * Returns win/draw/loss probs and the top-5 most likely exact scores.
 *
 * @param {number} xG1
 * @param {number} xG2
 * @param {number} [maxGoals=6]
 * @returns {{ winProb1: number, drawProb: number, winProb2: number, topScores: string[] }}
 */
function simulatePoisson(xG1, xG2, maxGoals = 6) {
  let winProb1 = 0, drawProb = 0, winProb2 = 0;
  const scoreMap = {};

  for (let g1 = 0; g1 <= maxGoals; g1++) {
    for (let g2 = 0; g2 <= maxGoals; g2++) {
      const p = poissonPmf(g1, xG1) * poissonPmf(g2, xG2);
      if (g1 > g2) winProb1 += p;
      else if (g1 === g2) drawProb += p;
      else winProb2 += p;
      scoreMap[`${g1}-${g2}`] = (scoreMap[`${g1}-${g2}`] || 0) + p;
    }
  }

  const topScores = Object.entries(scoreMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([score]) => score);

  return { winProb1, drawProb, winProb2, topScores };
}

/**
 * Apply Dixon-Coles style home advantage tweak (~8% boost for host nations).
 * @param {number} xG
 * @param {boolean} hasAdvantage
 * @returns {number}
 */
function applyHomeAdvantage(xG, hasAdvantage) {
  return hasAdvantage ? xG * 1.08 : xG;
}

/**
 * Run the full statistical model for a matchup.
 * Blends pre-tournament stats with in-tournament form, applies home advantage,
 * and returns all probability outputs.
 *
 * @param {object} s1 - { rank, goalsFor, goalsAgainst, form, tournamentGoalsFor?, tournamentPlayed? }
 * @param {object} s2 - same shape
 * @param {object} [opts] - { team1HomeAdvantage, team2HomeAdvantage }
 * @returns {object} statistical report consumed by Strategy Department
 */
function runStatisticalModel(s1, s2, opts = {}) {
  const blendGoals = (pre, tournament, played) => {
    if (!played || played === 0) return pre;
    const weight = Math.min(played * 0.25, 0.6);
    return pre * (1 - weight) + tournament * weight;
  };

  const gf1 = blendGoals(s1.goalsFor, s1.tournamentGoalsFor, s1.tournamentPlayed);
  const ga1 = blendGoals(s1.goalsAgainst, s1.tournamentGoalsAgainst, s1.tournamentPlayed);
  const gf2 = blendGoals(s2.goalsFor, s2.tournamentGoalsFor, s2.tournamentPlayed);
  const ga2 = blendGoals(s2.goalsAgainst, s2.tournamentGoalsAgainst, s2.tournamentPlayed);

  let xG1 = (gf1 * ga2) / LEAGUE_AVG;
  let xG2 = (gf2 * ga1) / LEAGUE_AVG;

  xG1 = Math.max(0.3, Math.min(xG1, 4.0));
  xG2 = Math.max(0.3, Math.min(xG2, 4.0));

  xG1 = applyHomeAdvantage(xG1, !!opts.team1HomeAdvantage);
  xG2 = applyHomeAdvantage(xG2, !!opts.team2HomeAdvantage);

  const { winProb1, drawProb, winProb2, topScores } = simulatePoisson(xG1, xG2);

  const rankGap     = Math.abs(s1.rank - s2.rank);
  const rankFavour1 = s1.rank < s2.rank;
  const rankBoost   = Math.min(rankGap * 0.001, 0.08);

  const adjWin1 = rankFavour1
    ? Math.min(winProb1 + rankBoost, 0.95)
    : Math.max(winProb1 - rankBoost, 0.05);
  const adjWin2 = !rankFavour1
    ? Math.min(winProb2 + rankBoost, 0.95)
    : Math.max(winProb2 - rankBoost, 0.05);
  const adjDraw = Math.max(1 - adjWin1 - adjWin2, 0.05);

  const statWinner =
    adjWin1 > adjWin2 && adjWin1 > adjDraw ? 'team1'
    : adjWin2 > adjWin1 && adjWin2 > adjDraw ? 'team2'
    : 'draw';

  const maxProb       = Math.max(adjWin1, adjDraw, adjWin2);
  const statConfidence = Math.round(maxProb * 100);

  return {
    xG1:           parseFloat(xG1.toFixed(2)),
    xG2:           parseFloat(xG2.toFixed(2)),
    winProb1:      parseFloat(adjWin1.toFixed(3)),
    drawProb:      parseFloat(adjDraw.toFixed(3)),
    winProb2:      parseFloat(adjWin2.toFixed(3)),
    topScores,
    predictedScore: topScores[0] || '1-0',
    statWinner,
    statConfidence,
    rankGap,
    rankFavour: rankFavour1 ? 'team1' : 'team2',
  };
}

/**
 * Format the statistical report as a text block for injection into Qwen prompts.
 * @param {object} report
 * @param {string} team1
 * @param {string} team2
 * @returns {string}
 */
function formatStatReport(report, team1, team2) {
  return [
    `📊 STATISTICAL MODEL (Poisson xG):`,
    `Expected Goals: ${team1} ${report.xG1} xG vs ${team2} ${report.xG2} xG`,
    `Win probabilities: ${team1} ${(report.winProb1 * 100).toFixed(1)}% | Draw ${(report.drawProb * 100).toFixed(1)}% | ${team2} ${(report.winProb2 * 100).toFixed(1)}%`,
    `Most likely scores: ${report.topScores.join(', ')}`,
    `Statistical favourite: ${report.statWinner === 'team1' ? team1 : report.statWinner === 'team2' ? team2 : 'Draw'} (${report.statConfidence}% confidence)`,
    `FIFA ranking gap: ${report.rankGap} places — ${report.rankFavour === 'team1' ? team1 : team2} ranked higher`,
  ].join('\n');
}

module.exports = { runStatisticalModel, formatStatReport };
