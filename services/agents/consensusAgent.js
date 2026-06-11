'use strict';

/**
 * Consensus Agent — Final Synthesis (includes Devil's Advocate step)
 *
 * This is now the ONLY Qwen call in full mode (besides tacticalAgent).
 * It receives:
 *   - Statistical model (code, Poisson xG)
 *   - Tactical report (Qwen call #1)
 *   - Historian data (vault extract, no Qwen)
 *   - Psychologist data (code-computed, no Qwen)
 *   - Qualifier stats (JSON data)
 *   - Weather context (code)
 *   - Calibration note (vault)
 *
 * The prompt includes an embedded Devil's Advocate step so Qwen challenges
 * its own draft before finalizing — same quality, one fewer round-trip.
 *
 * Total Qwen calls in full mode: 2 (tactical + this consensus).
 * Down from 5. Saves ~6-8 minutes per match analysis.
 */

/**
 * Build the consensus + devil's advocate synthesis prompt.
 */
function buildConsensusPrompt(
  team1, team2, group,
  statBlock, tacticalBlock, historianBlock, psychBlock,
  qualBlock, weatherBlock, calibrationNote,
  statReport
) {
  const winPct1 = (statReport.winProb1 * 100).toFixed(1);
  const drawPct = (statReport.drawProb  * 100).toFixed(1);
  const winPct2 = (statReport.winProb2  * 100).toFixed(1);

  return `/no_think
You are the HEAD ANALYST at a professional football intelligence firm. Your team has filed the reports below. Synthesise them into ONE definitive match prediction.

MATCH: ${team1} vs ${team2} | Group ${group} | Group Stage (draws are VALID)

══════════════════════════════════════════
SPECIALIST REPORTS
══════════════════════════════════════════

${statBlock}

${tacticalBlock}

${historianBlock}

${psychBlock}

${qualBlock}
${weatherBlock ? '\n' + weatherBlock : ''}
${calibrationNote ? '\n📋 CALIBRATION (our past bias): ' + calibrationNote : ''}

══════════════════════════════════════════
STEP 1 — DEVIL'S ADVOCATE (internal check)
══════════════════════════════════════════
Before finalizing, challenge your emerging view:
- What is the SINGLE best argument for the statistical underdog winning?
- Is the favourite at any rotation risk or complacency risk?
- Does any injury, weather, or revenge factor significantly shift the probabilities?
- If upset probability is >30%: lower your final confidence by at least 8 points.

══════════════════════════════════════════
SYNTHESIS RULES
══════════════════════════════════════════
1. ANCHOR to the statistical model — your confidence must stay within ±15% of ${statReport.statConfidence}% unless 2+ specialist reports override with strong reason.
2. QUALIFIER STATS matter — a team that scored 38 goals in qualifying is NOT the same as one that scored 15. Use the qualifier GF/GA per game alongside the base stats.
3. If rotation risk flagged → reduce confidence by 5-10 points; shift score prediction lower-scoring.
4. Score must reflect game style (cagey=1-0/0-0 more likely; open=2-1/2-0 more likely). Use stat model top scores: ${statReport.topScores.slice(0, 3).join(', ')}.
5. Name SPECIFIC PLAYERS in analysis_summary — generic output is not acceptable.
6. Group stage: draw prob = ${drawPct}% per the model. Respect this — do not force a winner if teams are evenly matched.
7. Win probabilities from stats: ${team1} ${winPct1}% | Draw ${drawPct}% | ${team2} ${winPct2}%.

Respond ONLY with valid JSON — no markdown, no preamble:
{"winner":"${team1}|${team2}|draw","confidence":75,"predicted_score":"2-1","score_reasoning":"Why ${team1} scores X: [specific reason + player names]. Why ${team2} scores Y: [specific reason + player names].","key_factors":["factor1 with specifics","factor2 with specifics","factor3 with specifics"],"analysis_summary":"3 sentences. Name specific players. Cover the key tactical battle, the decisive factor, and the risk.","risk_factor":"low|medium|high","devil_upset_pct":22,"devil_upset_scenario":"one sentence on how the underdog wins","agent_votes":{"statistical":"${team1}|${team2}|draw","tactical":"${team1}|${team2}|neutral","historical":"${team1}|${team2}|neutral","psychological":"${team1}|${team2}|neutral"}}`;
}

/**
 * Build the qualifier context block for injection into the prompt.
 * @param {object} s1 - enriched stats with .qualifier
 * @param {object} s2
 * @param {string} team1
 * @param {string} team2
 * @returns {string}
 */
function buildQualifierBlock(s1, s2, team1, team2) {
  const lines = ['🏆 QUALIFYING CAMPAIGN PERFORMANCE:'];

  const fmt = (teamName, q) => {
    if (!q) return `${teamName}: No qualifier data available.`;
    const gfPg = q.played > 0 ? (q.goalsFor / q.played).toFixed(2) : '?';
    const gaPg = q.played > 0 ? (q.goalsAgainst / q.played).toFixed(2) : '?';
    return `${teamName} (${q.confederation}): ${q.won}W-${q.drawn}D-${q.lost}L | GF/g: ${gfPg} | GA/g: ${gaPg} | GD: ${q.goalDiff > 0 ? '+' : ''}${q.goalDiff} | via: ${(q.method || '').replace(/_/g, ' ')}${q.note ? '\n  → ' + q.note : ''}`;
  };

  lines.push(fmt(team1, s1.qualifier));
  lines.push(fmt(team2, s2.qualifier));

  // Flag significant qualifier quality gap
  if (s1.qualifier && s2.qualifier) {
    const gd1 = s1.qualifier.goalDiff || 0;
    const gd2 = s2.qualifier.goalDiff || 0;
    const gfpg1 = s1.qualifier.played > 0 ? s1.qualifier.goalsFor / s1.qualifier.played : 0;
    const gfpg2 = s2.qualifier.played > 0 ? s2.qualifier.goalsFor / s2.qualifier.played : 0;
    if (Math.abs(gd1 - gd2) >= 15) {
      const better = gd1 > gd2 ? team1 : team2;
      lines.push(`⚠️ SIGNIFICANT QUALIFIER GAP: ${better} had a far superior qualifying campaign — weight this in confidence.`);
    }
    if (Math.abs(gfpg1 - gfpg2) >= 0.8) {
      const moreAttack = gfpg1 > gfpg2 ? team1 : team2;
      lines.push(`⚠️ ATTACKING QUALIFIER GAP: ${moreAttack} scored significantly more per game in qualifying — they are the more potent attacking team.`);
    }
  }

  return lines.join('\n');
}

/**
 * Run the consensus agent — second and final Qwen call in full mode.
 * @param {string} team1
 * @param {string} team2
 * @param {string} group
 * @param {object} reports - { stat, tactical, historian, psych, weather, calibration, s1, s2 }
 * @param {Function} runOllama
 * @param {object} formatters - { formatStatReport, formatTacticalReport, formatHistorianReport, formatPsychReport, buildWeatherContext }
 * @returns {Promise<object>}
 */
async function runConsensusAgent(
  team1, team2, group,
  { stat, tactical, historian, psych, weather, calibration, s1, s2 },
  runOllama,
  { formatStatReport, formatTacticalReport, formatHistorianReport, formatPsychReport, buildWeatherContext }
) {
  const statBlock      = formatStatReport(stat, team1, team2);
  const tacticalBlock  = formatTacticalReport(tactical, team1, team2);
  const historianBlock = formatHistorianReport(historian, team1, team2);
  const psychBlock     = formatPsychReport(psych, team1, team2);
  const qualBlock      = buildQualifierBlock(s1, s2, team1, team2);
  const weatherBlock   = weather ? buildWeatherContext(weather) : '';
  const calibrationNote = calibration || '';

  const prompt = buildConsensusPrompt(
    team1, team2, group,
    statBlock, tacticalBlock, historianBlock, psychBlock,
    qualBlock, weatherBlock, calibrationNote,
    stat
  );

  try {
    const result = await runOllama(prompt);
    console.log(`[CONSENSUS] ${team1} vs ${team2} — winner: ${result.winner} | score: ${result.predicted_score} | conf: ${result.confidence}% | upset_pct: ${result.devil_upset_pct}%`);
    return result;
  } catch (err) {
    console.error('[CONSENSUS] Agent failed:', err.message);
    // Graceful fallback to statistical model
    const fallbackWinner = stat.statWinner === 'team1' ? team1 : stat.statWinner === 'team2' ? team2 : 'draw';
    return {
      winner: fallbackWinner,
      confidence: stat.statConfidence,
      predicted_score: stat.topScores[0] || '1-0',
      score_reasoning: `Statistical model fallback (xG ${stat.xG1} vs ${stat.xG2}). Consensus unavailable.`,
      key_factors: [`xG advantage: ${stat.xG1} vs ${stat.xG2}`, 'Ranking differential', 'Statistical model baseline'],
      analysis_summary: `Statistical model predicts ${fallbackWinner} based on expected goals (${stat.xG1} vs ${stat.xG2}). Full AI synthesis was unavailable due to model error.`,
      risk_factor: 'high',
      devil_upset_pct: 25,
      devil_upset_scenario: 'Unknown — fallback mode.',
      agent_votes: { statistical: fallbackWinner, tactical: 'neutral', historical: 'neutral', psychological: 'neutral' },
    };
  }
}

module.exports = { runConsensusAgent, buildQualifierBlock };
