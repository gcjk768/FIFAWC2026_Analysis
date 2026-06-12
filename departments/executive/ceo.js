'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║        WC2026 ANALYTICS CORP — EXECUTIVE OFFICE             ║
 * ║                                                              ║
 * ║  CEO (Chief Executive Officer)                               ║
 * ║  Role: Receives the match brief, assembles department heads, ║
 * ║        coordinates the full analysis pipeline, and delivers  ║
 * ║        the final prediction to the board (server.js).        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Two operating modes:
 *   "fast" — CEO delegates to Analytics + Scouting only (1 Qwen call)
 *   "full" — Full board meeting: all departments report (2 Qwen calls)
 *
 * Department heads briefed in full mode:
 *   1. Scouting       — live team data enrichment
 *   2. Analytics       — Poisson xG statistical model
 *   3. Strategy        — Tactical (Qwen #1) + Historian + Psychologist
 *   4. Strategy        — Chief Strategist synthesis (Qwen #2)
 *   5. Analytics       — Calibration note injection
 */

const { enrichTeamStats, formatTeamProfile } = require('../scouting/headScout');
const { runStatisticalModel, formatStatReport } = require('../analytics/quantModel');
const { runTacticalAgent, formatTacticalReport } = require('../strategy/tactician');
const { runHistorianAgent, formatHistorianReport } = require('../strategy/historian');
const { runPsychologistAgent, formatPsychReport } = require('../strategy/psychologist');
const { runConsensusAgent } = require('../strategy/chiefStrategist');
const { fetchCalibrationNote } = require('../analytics/calibrationDesk');

// ─── FAST MODE PROMPT ─────────────────────────────────────────────────────────

/**
 * Build the single-call prompt with xG anchor + step-by-step reasoning.
 * Used in fast mode — one Qwen call covers the full analysis.
 *
 * @param {string} team1
 * @param {string} team2
 * @param {string} group
 * @param {object} s1
 * @param {object} s2
 * @param {string} obsidianContext
 * @param {object} statReport
 * @returns {string}
 */
function buildFastPrompt(team1, team2, group, s1, s2, obsidianContext, statReport) {
  return `/no_think
You are a professional football analyst for FIFA World Cup 2026. Think step by step, then output JSON.

═══ MATCH ═══
${team1} vs ${team2} | Group ${group} | Group Stage (draws valid)

═══ TEAM DATA ═══
${formatTeamProfile(team1, s1)}

${formatTeamProfile(team2, s2)}

═══ STATISTICAL ANCHOR — use as your baseline ═══
Expected Goals: ${team1} ${statReport.xG1} xG vs ${team2} ${statReport.xG2} xG
Win probabilities: ${team1} ${(statReport.winProb1 * 100).toFixed(1)}% | Draw ${(statReport.drawProb * 100).toFixed(1)}% | ${team2} ${(statReport.winProb2 * 100).toFixed(1)}%
Most likely scores: ${statReport.topScores.join(', ')}
Statistical favourite: ${statReport.statWinner === 'team1' ? team1 : statReport.statWinner === 'team2' ? team2 : 'Draw'}

═══ INTELLIGENCE NOTES ═══
${obsidianContext || 'No additional context available.'}

═══ REASONING STEPS ═══
STEP 1 — STATISTICAL: Is the xG anchor reasonable? Any adjustments needed?
STEP 2 — TACTICAL: What is the KEY tactical battle? Who wins the midfield?
STEP 3 — CONTEXT: Any injury, motivation, or venue factor that shifts the picture?
STEP 4 — SCORE: What is the most realistic score? (use stat model top scores as starting point)
STEP 5 — RISK: What is the realistic upset scenario and how likely?

Respond ONLY with valid JSON — no markdown, no preamble:
{"winner":"${team1}|${team2}|draw","confidence":75,"predicted_score":"2-1","score_reasoning":"Why ${team1} scores X: [reason with player names]. Why ${team2} scores Y: [reason].","key_factors":["factor1","factor2","factor3"],"analysis_summary":"3 sentences. Name specific players. Cover main tactical battle.","risk_factor":"low|medium|high"}`;
}

// ─── CONTEXT HELPERS ──────────────────────────────────────────────────────────

/**
 * Extract H2H section from vault head-to-head note for this specific matchup.
 * @param {string} content
 * @param {string} team1
 * @param {string} team2
 * @returns {string}
 */
function extractH2HSection(content, team1, team2) {
  if (!content) return '';
  const lines = content.split('\n');
  const pattern = new RegExp(`${team1}.*${team2}|${team2}.*${team1}`, 'i');
  let inSection = false;
  const out = [];
  for (const line of lines) {
    if (line.startsWith('## ') && pattern.test(line)) { inSection = true; out.push(line); continue; }
    if (inSection && line.startsWith('## ')) break;
    if (inSection) out.push(line);
  }
  return out.join('\n');
}

/**
 * Gather Obsidian team notes for the Tactical briefing.
 * @param {string} team1
 * @param {string} team2
 * @param {Function} obsidianGet
 * @returns {Promise<string>}
 */
async function gatherTacticalContext(team1, team2, obsidianGet) {
  const parts = [];
  try {
    const [r1, r2] = await Promise.all([
      obsidianGet(`/search?q=${encodeURIComponent(team1)}`),
      obsidianGet(`/search?q=${encodeURIComponent(team2)}`),
    ]);
    if (r1.results?.[0]) parts.push(`--- ${team1} Notes ---\n${r1.results[0].content}`);
    if (r2.results?.[0]) parts.push(`--- ${team2} Notes ---\n${r2.results[0].content}`);
  } catch { /* non-fatal */ }
  return parts.join('\n\n');
}

/**
 * Fetch H2H context from Obsidian Knowledge vault.
 * @param {string} team1
 * @param {string} team2
 * @param {Function} obsidianGet
 * @returns {Promise<string>}
 */
async function gatherH2HContext(team1, team2, obsidianGet) {
  try {
    const h2h = await obsidianGet('/read/WC2026%2Fhead-to-head.md');
    return extractH2HSection(h2h.content || '', team1, team2);
  } catch {
    return '';
  }
}

// ─── CEO MAIN FUNCTION ────────────────────────────────────────────────────────

/**
 * CEO runs the full board meeting — assembles department reports and delivers
 * the final prediction.
 *
 * @param {object} fixture  - { matchId, team1, team2, group, matchday, venue, dateSgt, dateIso }
 * @param {object} deps     - injected dependencies from server.js
 * @param {string} [mode]   - "fast" | "full" (default: "full")
 * @returns {Promise<object>} prediction object ready to save
 */
async function runOrchestrator(fixture, deps, mode = 'full') {
  const { team1, team2, group, matchday, venue, dateSgt, dateIso } = fixture;

  const {
    runOllama,
    TEAM_STATS,
    obsidianGet,
    obsidianPost,
    gatherObsidianContext,
    fetchMatchWeather,
    buildWeatherContext,
  } = deps;

  console.log(`[CEO] 📋 Board meeting called: ${team1} vs ${team2} (Group ${group}) — mode: ${mode.toUpperCase()}`);

  // ── SCOUTING DEPT BRIEF — enrich team stats with live tournament data ──────
  console.log(`[CEO] → Briefing Scouting Department...`);
  const { enriched1, enriched2 } = await enrichTeamStats(team1, team2, TEAM_STATS);

  // ── ANALYTICS DEPT BRIEF — Poisson xG model (pure maths, no LLM) ──────────
  console.log(`[CEO] → Briefing Analytics Department...`);
  const homeVenues = {
    'USA':    ['metlife', 'at&t', 'sofi', "levi's", 'allegiant', 'state farm', 'arrowhead', 'empower', 'nrg', 'hard rock', 'lincoln', 'gillette'],
    'Canada': ['bc place', 'bmo'],
    'Mexico': ['azteca', 'akron'],
  };
  const venueL = (venue || '').toLowerCase();
  const team1Home = (homeVenues[team1] || []).some((v) => venueL.includes(v));
  const team2Home = (homeVenues[team2] || []).some((v) => venueL.includes(v));

  const statReport = runStatisticalModel(enriched1, enriched2, {
    team1HomeAdvantage: team1Home,
    team2HomeAdvantage: team2Home,
  });
  console.log(`[CEO] Analytics: ${team1} xG ${statReport.xG1} vs ${team2} xG ${statReport.xG2} | Stat winner: ${statReport.statWinner}`);

  // ── FAST MODE — single Qwen call, CEO decides without full board ──────────
  if (mode === 'fast') {
    console.log(`[CEO] Fast mode: skipping full board — running solo analysis...`);
    let obsCtx = '';
    try {
      const matchDate = dateSgt ? dateSgt.split(' ')[0] : null;
      obsCtx = await gatherObsidianContext(team1, team2, venue, matchDate);
    } catch { /* non-fatal */ }

    const prompt = buildFastPrompt(team1, team2, group, enriched1, enriched2, obsCtx, statReport);
    const result = await runOllama(prompt);
    console.log(`[CEO] Fast decision: ${result.winner} ${result.predicted_score} (${result.confidence}%)`);
    return { ...result, _mode: 'fast', _statReport: statReport };
  }

  // ── FULL MODE — all department heads report to the board ──────────────────
  console.log(`[CEO] Full board in session. Gathering all department reports...`);

  const matchDate = dateSgt ? dateSgt.split(' ')[0] : null;

  // All non-LLM context fetched in parallel — no Qwen calls yet
  const [tacticalCtx, h2hRawContent, weather, calibrationNote] = await Promise.all([
    gatherTacticalContext(team1, team2, obsidianGet).catch(() => ''),
    obsidianGet('/read/WC2026%2Fhead-to-head.md').then((d) => d.content || '').catch(() => ''),
    (fetchMatchWeather && venue && matchDate)
      ? fetchMatchWeather(venue, matchDate).catch(() => null)
      : Promise.resolve(null),
    fetchCalibrationNote().catch(() => ''),
  ]);

  // Strategy Dept — Historian & Psychologist (code-only, no Qwen)
  console.log(`[CEO] → Strategy Department: Historian + Psychologist reports filed (code-computed)`);
  const historian = runHistorianAgent(team1, team2, h2hRawContent);
  const psych     = await runPsychologistAgent(team1, team2, group, matchday || 1, venue, enriched1, enriched2);

  // Strategy Dept — Tactical Analyst (Qwen call #1)
  console.log(`[CEO] → Strategy Department: Tactical Analyst reporting (Qwen #1)...`);
  const tactical = await runTacticalAgent(team1, team2, group, enriched1, enriched2, tacticalCtx, runOllama);

  // Strategy Dept — Chief Strategist synthesis with embedded Devil's Advocate (Qwen call #2)
  console.log(`[CEO] → Strategy Department: Chief Strategist synthesising final prediction (Qwen #2)...`);
  const finalPrediction = await runConsensusAgent(
    team1, team2, group,
    { stat: statReport, tactical, historian, psych, weather, calibration: calibrationNote, s1: enriched1, s2: enriched2 },
    runOllama,
    { formatStatReport, formatTacticalReport, formatHistorianReport, formatPsychReport, buildWeatherContext }
  );

  console.log(`[CEO] ✅ Board decision: ${finalPrediction.winner} ${finalPrediction.predicted_score} (${finalPrediction.confidence}%) | Upset risk: ${finalPrediction.devil_upset_pct}%`);

  return {
    ...finalPrediction,
    _mode:          'full',
    _agentReports:  { stat: statReport, tactical, historian, psych },
  };
}

module.exports = { runOrchestrator };
