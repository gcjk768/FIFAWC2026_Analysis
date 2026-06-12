'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  STRATEGY DEPT — CHIEF STRATEGIST                           ║
 * ║  Role: Final synthesis — the definitive prediction          ║
 * ║  ⚡ LLM CALL — Qwen call #2 in full mode (the last one)     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Receives briefings from ALL departments:
 *   📊 Analytics    — Poisson xG statistical model
 *   ⚽ Tactical     — Tactical matchup analysis (Qwen #1)
 *   📖 Historian    — H2H historical records
 *   🧠 Psychologist — Motivation + pressure factors
 *   🌦️ Weather      — Venue conditions
 *   📋 Calibration  — Past prediction bias notes
 *
 * Includes an embedded Devil's Advocate self-challenge step to
 * question the emerging consensus before finalising — eliminating
 * the need for a separate Risk Analyst LLM call.
 *
 * Weighting: Stats 30% | Tactical 25% | Psych 20% | History 15% | Devil 10%
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
DEPARTMENT REPORTS
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
1. ANCHOR to the statistical model — your confidence must stay within ±15% of ${statReport.statConfidence}% unless 2+ department reports override with strong reason.
2. QUALIFIER STATS matter — a team that scored 38 goals in qualifying is NOT the same as one that scored 15.
3. If rotation risk flagged → reduce confidence by 5-10 points; shift score prediction lower-scoring.
4. Score must reflect game style (cagey=1-0/0-0 more likely; open=2-1/2-0 more likely). Use stat model top scores: ${statReport.topScores.slice(0, 3).join(', ')}.
5. Name SPECIFIC PLAYERS in analysis_summary — generic output is not acceptable.
6. Group stage: draw prob = ${drawPct}% per the model. Respect this — do not force a winner if teams are evenly matched.
7. Win probabilities from stats: ${team1} ${winPct1}% | Draw ${drawPct}% | ${team2} ${winPct2}%.

Respond ONLY with valid JSON — no markdown, no preamble:
{"winner":"${team1}|${team2}|draw","confidence":75,"predicted_score":"2-1","score_reasoning":"Why ${team1} scores X: [specific reason + player names]. Why ${team2} scores Y: [specific reason + player names].","key_factors":["factor1 with specifics","factor2 with specifics","factor3 with specifics"],"analysis_summary":"3 sentences. Name specific players. Cover the key tactical battle, the decisive factor, and the risk.","risk_factor":"low|medium|high","devil_upset_pct":22,"devil_upset_scenario":"one sentence on how the underdog wins","agent_votes":{"statistical":"${team1}|${team2}|draw","tactical":"${team1}|${team2}|neutral","historical":"${team1}|${team2}|neutral","psychological":"${team1}|${team2}|neutral"}}`;
}

/**
 * Build the qualifier campaign performance block for the Strategist prompt.
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

  if (s1.qualifier && s2.qualifier) {
    const gd1   = s1.qualifier.goalDiff || 0;
    const gd2   = s2.qualifier.goalDiff || 0;
    const gfpg1 = s1.qualifier.played > 0 ? s1.qualifier.goalsFor / s1.qualifier.played : 0;
    const gfpg2 = s2.qualifier.played > 0 ? s2.qualifier.goalsFor / s2.qualifier.played : 0;
    if (Math.abs(gd1 - gd2) >= 15) {
      const better = gd1 > gd2 ? team1 : team2;
      lines.push(`⚠️ SIGNIFICANT QUALIFIER GAP: ${better} had a far superior qualifying campaign — weight this in confidence.`);
    }
    if (Math.abs(gfpg1 - gfpg2) >= 0.8) {
      const moreAttack = gfpg1 > gfpg2 ? team1 : team2;
      lines.push(`⚠️ ATTACKING QUALIFIER GAP: ${moreAttack} scored significantly more per game in qualifying.`);
    }
  }

  return lines.join('\n');
}

/**
 * Fill any fields Qwen omitted from its JSON with statistical model defaults,
 * so a partial response never reaches Telegram/Obsidian as "undefined".
 *
 * @param {object} raw - parsed Qwen JSON (may be missing fields)
 * @param {object} stat - statistical model report
 * @param {string} team1
 * @param {string} team2
 * @returns {object}
 */
function sanitizeDecision(raw, stat, team1, team2) {
  const statWinner = stat.statWinner === 'team1' ? team1 : stat.statWinner === 'team2' ? team2 : 'draw';
  const result = { ...raw };
  if (![team1, team2, 'draw'].includes(result.winner)) result.winner = statWinner;
  if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 100) {
    result.confidence = stat.statConfidence;
  }
  if (!/^\d+-\d+$/.test(result.predicted_score || '')) result.predicted_score = stat.topScores[0] || '1-1';
  if (!result.score_reasoning) result.score_reasoning = `Score anchored to statistical model (xG ${stat.xG1} vs ${stat.xG2}).`;
  if (!Array.isArray(result.key_factors) || result.key_factors.length === 0) {
    result.key_factors = [`xG: ${stat.xG1} vs ${stat.xG2}`, 'Ranking differential', 'Statistical model baseline'];
  }
  if (!result.analysis_summary) result.analysis_summary = result.score_reasoning;
  if (!['low', 'medium', 'high'].includes(result.risk_factor)) result.risk_factor = 'medium';
  if (typeof result.devil_upset_pct !== 'number') result.devil_upset_pct = 25;
  if (!result.devil_upset_scenario) result.devil_upset_scenario = 'No specific upset scenario identified.';
  if (!result.agent_votes || typeof result.agent_votes !== 'object') {
    result.agent_votes = { statistical: statWinner, tactical: 'neutral', historical: 'neutral', psychological: 'neutral' };
  }

  // Reconcile winner vs score — Qwen sometimes anchors the score to the stat
  // model's top score (often a draw) while still naming a winner
  const [g1, g2] = result.predicted_score.split('-').map(Number);
  if (g1 === g2 && result.winner !== 'draw') {
    const winnerIsTeam1 = result.winner === team1;
    const consistent = (stat.topScores || []).find((s) => {
      const [x, y] = s.split('-').map(Number);
      return winnerIsTeam1 ? x > y : y > x;
    });
    if (consistent) result.predicted_score = consistent;
    else result.winner = 'draw';
  } else if (g1 !== g2) {
    const scoreWinner = g1 > g2 ? team1 : team2;
    if (result.winner === 'draw') result.winner = scoreWinner;
    else if (result.winner !== scoreWinner) result.predicted_score = `${g2}-${g1}`;
  }
  return result;
}

/**
 * Run the Chief Strategist — second and final Qwen call in full mode.
 * Receives all department reports and returns the definitive prediction.
 *
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
    const raw = await runOllama(prompt);
    const result = sanitizeDecision(raw, stat, team1, team2);
    console.log(`[STRATEGY:CHIEF] ${team1} vs ${team2} — decision: ${result.winner} ${result.predicted_score} | confidence: ${result.confidence}% | upset risk: ${result.devil_upset_pct}%`);
    return result;
  } catch (err) {
    console.error('[STRATEGY:CHIEF] Chief Strategist failed — falling back to statistical model:', err.message);
    const fallbackWinner = stat.statWinner === 'team1' ? team1 : stat.statWinner === 'team2' ? team2 : 'draw';
    return {
      winner:               fallbackWinner,
      confidence:           stat.statConfidence,
      predicted_score:      stat.topScores[0] || '1-0',
      score_reasoning:      `Statistical model fallback (xG ${stat.xG1} vs ${stat.xG2}). Chief Strategist unavailable.`,
      key_factors:          [`xG advantage: ${stat.xG1} vs ${stat.xG2}`, 'Ranking differential', 'Statistical model baseline'],
      analysis_summary:     `Statistical model predicts ${fallbackWinner} based on expected goals (${stat.xG1} vs ${stat.xG2}). Full synthesis was unavailable.`,
      risk_factor:          'high',
      devil_upset_pct:      25,
      devil_upset_scenario: 'Unknown — fallback mode.',
      agent_votes:          { statistical: fallbackWinner, tactical: 'neutral', historical: 'neutral', psychological: 'neutral' },
    };
  }
}

module.exports = { runConsensusAgent, buildQualifierBlock, sanitizeDecision };
