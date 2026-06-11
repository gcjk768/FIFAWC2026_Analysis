'use strict';

const path = require('path');

const KNOCKOUT_FILE = path.join(__dirname, '../data/knockout.json');

// ─── BRACKET DEFINITION ───────────────────────────────────────────────────────

/**
 * Pre-set WC2026 Round of 32 bracket based on official draw seeding.
 * Pairs flow sequentially: [0,1] → R16[0], [2,3] → R16[1], etc.
 * HALF 1 (indices 0-7)  → produces SF: bracket-left winner vs bracket-right winner
 * HALF 2 (indices 8-15) → produces SF: bracket-left winner vs bracket-right winner
 */
const R32_BRACKET = [
  // HALF 1 — Group H/G/D/F/J/K winners + assigned 3rd-place
  { id: 'r32-0',  team1: 'Spain',                 team2: 'Norway'                 },
  { id: 'r32-1',  team1: 'Morocco',                team2: 'Iran'                   },
  { id: 'r32-2',  team1: 'USA',                    team2: 'Australia'              },
  { id: 'r32-3',  team1: 'Senegal',                team2: 'Ivory Coast'            },
  { id: 'r32-4',  team1: 'Argentina',              team2: 'Egypt'                  },
  { id: 'r32-5',  team1: 'Netherlands',            team2: 'Croatia'                },
  { id: 'r32-6',  team1: 'Portugal',               team2: 'Sweden'                 },
  { id: 'r32-7',  team1: 'Mexico',                 team2: 'Canada'                 },
  // HALF 2 — Group I/G/K/B/L/E/C/H runners + assigned 3rd-place
  { id: 'r32-8',  team1: 'France',                 team2: 'Algeria'                },
  { id: 'r32-9',  team1: 'Belgium',                team2: 'Austria'                },
  { id: 'r32-10', team1: 'Colombia',               team2: 'Turkiye'                },
  { id: 'r32-11', team1: 'Switzerland',            team2: 'Ecuador'                },
  { id: 'r32-12', team1: 'England',                team2: 'Bosnia and Herzegovina' },
  { id: 'r32-13', team1: 'Germany',                team2: 'South Korea'            },
  { id: 'r32-14', team1: 'Brazil',                 team2: 'South Africa'           },
  { id: 'r32-15', team1: 'Uruguay',                team2: 'Japan'                  },
];

const STAGE_LABELS = {
  roundOf32:     (i) => `Round of 32 — Match ${i + 1} of 16`,
  roundOf16:     (i) => `Round of 16 — Match ${i + 1} of 8`,
  quarterFinals: (i) => `Quarter-Final ${i + 1} of 4`,
  semiFinals:    (i) => `Semi-Final ${i + 1} of 2`,
  final:         ()  => 'Final',
};

// ─── KNOCKOUT PROMPT ──────────────────────────────────────────────────────────

/**
 * Build a knockout-specific Ollama prompt. No draws — must pick a winner.
 * @param {string} team1
 * @param {string} team2
 * @param {string} stage
 * @param {object} s1 - team1 stats
 * @param {object} s2 - team2 stats
 * @param {string} obsidianContext
 * @returns {string}
 */
function buildKnockoutPrompt(team1, team2, stage, s1, s2, obsidianContext = '') {
  return `/no_think
You are an expert football analyst for FIFA World Cup 2026.

MATCH: ${team1} vs ${team2}
STAGE: ${stage}
RULES: KNOCKOUT — NO DRAWS ALLOWED.
  90 min normal time → if level: 30 min extra time → if still level: penalty shootout.
  You MUST pick a winner — draw is not a valid outcome.

${team1}:
- FIFA Ranking: #${s1.rank}
- Avg Goals Scored/Game: ${s1.goalsFor}
- Avg Goals Conceded/Game: ${s1.goalsAgainst}
- Recent Form (last 5, newest first): ${s1.form}

${team2}:
- FIFA Ranking: #${s2.rank}
- Avg Goals Scored/Game: ${s2.goalsFor}
- Avg Goals Conceded/Game: ${s2.goalsAgainst}
- Recent Form (last 5, newest first): ${s2.form}
${obsidianContext ? '\nADDITIONAL CONTEXT FROM NOTES:\n' + obsidianContext : ''}
INSTRUCTIONS:
- winner MUST be exactly "${team1}" or "${team2}" — no other string
- If closely matched predict extra_time: true or penalties: true
- penalty_score: null unless penalties is true — use "4-3" format (winner pens : loser pens)
- predicted_score: regular-time score only (e.g. "1-1" if goes to pens)
- Later-round fatigue, squad depth, and big-game mentality matter more than rankings alone
- Confidence: 50 = near coin flip, 90 = very likely winner
- analysis_summary: 2-3 sentences of specific tactical reasoning

Respond ONLY with valid JSON, no markdown, no explanation:
{"winner":"${team1}|${team2}","confidence":75,"predicted_score":"2-1","extra_time":false,"penalties":false,"penalty_score":null,"key_factors":["factor1","factor2","factor3"],"analysis_summary":"2-3 sentence tactical breakdown.","risk_factor":"low|medium|high"}`;
}

// ─── BRACKET PROGRESSION ─────────────────────────────────────────────────────

/**
 * Pair consecutive winners to build the next round's matches.
 * [r0, r1, r2, r3] → [{team1: r0.winner, team2: r1.winner}, {team1: r2.winner, team2: r3.winner}]
 * @param {object[]} results - array of match prediction objects with .winner field
 * @returns {object[]}
 */
function buildNextRound(results) {
  const next = [];
  for (let i = 0; i < results.length; i += 2) {
    next.push({ team1: results[i].winner, team2: results[i + 1].winner });
  }
  return next;
}

// ─── FORMATTERS ───────────────────────────────────────────────────────────────

/**
 * Format a single match result as a display line.
 * @param {object} m
 * @returns {string}
 */
function matchLine(m) {
  const loser = m.winner === m.team1 ? m.team2 : m.team1;
  const detail = [
    m.predicted_score,
    m.extra_time && !m.penalties ? 'AET' : null,
    m.penalties ? `pens ${m.penalty_score || '?'}` : null,
  ].filter(Boolean).join(' ');
  return `${m.winner} (${detail}) vs ${loser}`;
}

/**
 * Format the full bracket as a Telegram MarkdownV2 message.
 * @param {object} predictions
 * @returns {string}
 */
function formatBracketTelegram(predictions) {
  const esc = (t) => String(t || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
  const lines = ['⚽ *WC2026 KNOCKOUT PREDICTIONS*', `_Powered by qwen3\\.6:35b_`, ''];

  const renderRound = (key, label) => {
    const data = predictions[key];
    if (!data) return;
    const matches = Array.isArray(data) ? data : [data];
    if (matches.length === 0) return;
    lines.push(`*${label}*`);
    for (const m of matches) {
      const loser = m.winner === m.team1 ? m.team2 : m.team1;
      const et = m.extra_time && !m.penalties ? ' \\(AET\\)' : '';
      const pen = m.penalties ? ` \\(pens ${esc(m.penalty_score || '?')}\\)` : '';
      lines.push(`🏆 ${esc(m.winner)} ${esc(m.predicted_score)}${et}${pen} ${esc(loser)} \\| ${m.confidence}%`);
    }
    lines.push('');
  };

  renderRound('roundOf32', 'ROUND OF 32');
  renderRound('roundOf16', 'ROUND OF 16');
  renderRound('quarterFinals', 'QUARTER\\-FINALS');
  renderRound('semiFinals', 'SEMI\\-FINALS');
  renderRound('final', 'FINAL');

  if (predictions.champion) lines.push(`🥇 *CHAMPION: ${esc(predictions.champion)}*`);

  return lines.join('\n');
}

/**
 * Format the full bracket as an Obsidian markdown note.
 * @param {object} predictions
 * @returns {string}
 */
function formatBracketNote(predictions) {
  const now = new Date().toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const lines = [
    '# WC2026 Knockout Bracket — Qwen Predictions',
    `*Generated: ${now} SGT | Model: qwen3.6:35b*`,
    '',
  ];

  const renderRound = (key, label) => {
    const data = predictions[key];
    if (!data) return;
    const matches = Array.isArray(data) ? data : [data];
    if (matches.length === 0) return;
    lines.push(`## ${label}`);
    for (const m of matches) {
      lines.push(`- **${matchLine(m)}** — ${m.confidence}% | ${m.risk_factor} risk`);
      if (m.analysis_summary) lines.push(`  > ${m.analysis_summary}`);
      if (m.key_factors && m.key_factors.length > 0) {
        lines.push(`  > Key: ${m.key_factors.join(' · ')}`);
      }
    }
    lines.push('');
  };

  renderRound('roundOf32', 'Round of 32');
  renderRound('roundOf16', 'Round of 16');
  renderRound('quarterFinals', 'Quarter-Finals');
  renderRound('semiFinals', 'Semi-Finals');
  renderRound('final', 'Final');

  if (predictions.champion) lines.push(`## 🏆 Predicted Champion: **${predictions.champion}**`);

  return lines.join('\n');
}

// ─── MAIN ANALYSIS ────────────────────────────────────────────────────────────

/**
 * Run the full Qwen knockout bracket prediction from R32 to Final.
 * Saves progress to knockout.json after every single match.
 * Fires Telegram + Obsidian on completion.
 *
 * @param {object} deps
 * @param {Function} deps.runOllama
 * @param {Function} deps.gatherObsidianContext
 * @param {Function} deps.obsidianPost
 * @param {Function} deps.telegramPost
 * @param {Function} deps.writeJson  - writeJson(filePath, data)
 * @param {Function} deps.readJson   - readJson(filePath) → object
 * @param {object}   deps.TEAM_STATS
 * @param {Function} onProgress - SSE callback (data) => void
 * @returns {Promise<object>} completed predictions object
 */
async function analyzeKnockoutBracket(deps, onProgress) {
  const { runOllama, gatherObsidianContext, obsidianPost, telegramPost, writeJson, readJson, TEAM_STATS } = deps;

  const DEFAULT_STATS = { rank: 99, goalsFor: 1.0, goalsAgainst: 1.5, form: 'DDDDD' };
  const getStats = (name) => TEAM_STATS[name] || DEFAULT_STATS;
  const notify = (data) => { if (onProgress) onProgress(data); };

  // Load or init knockout.json
  let ko = readJson(KNOCKOUT_FILE);
  if (!ko || typeof ko !== 'object') ko = {};
  if (!ko.rounds) {
    ko.rounds = { roundOf32: [], roundOf16: [], quarterFinals: [], semiFinals: [], thirdPlace: null, final: null };
  }
  ko.predictions = { roundOf32: [], roundOf16: [], quarterFinals: [], semiFinals: [], final: null, champion: null, analyzedAt: null };
  writeJson(KNOCKOUT_FILE, ko);

  /** Analyze one match, return prediction object. */
  async function analyzeMatch(team1, team2, stageLabel, venue = null, matchDate = null) {
    notify({ type: 'match_start', team1, team2, stage: stageLabel });
    console.log(`[KNOCKOUT] Analyzing: ${team1} vs ${team2} (${stageLabel})`);

    let obsidianContext = '';
    try {
      // Pass venue + date so weather is injected into the prompt
      obsidianContext = await gatherObsidianContext(team1, team2, venue, matchDate);
    } catch (err) {
      console.log('[KNOCKOUT] Obsidian context error (non-fatal):', err.message);
    }

    const prompt = buildKnockoutPrompt(team1, team2, stageLabel, getStats(team1), getStats(team2), obsidianContext);
    const result = await runOllama(prompt);

    // Guard: ensure winner is one of the two teams, never 'draw' or garbage
    if (result.winner !== team1 && result.winner !== team2) {
      console.warn(`[KNOCKOUT] Invalid winner "${result.winner}" — defaulting to ${team1}`);
      result.winner = team1;
    }

    const prediction = {
      team1,
      team2,
      stage: stageLabel,
      analyzedAt: new Date().toISOString(),
      ...result,
    };

    notify({ type: 'match_done', team1, team2, stage: stageLabel, prediction });
    return prediction;
  }

  /** Analyze a full round of matches, persisting after each one. */
  async function analyzeRound(matches, roundKey) {
    const results = [];
    notify({ type: 'round_start', round: roundKey, total: matches.length });

    // Pull actual match venue/date from API-sourced knockout data if available
    const apiRound = Array.isArray(ko.rounds[roundKey]) ? ko.rounds[roundKey] : [];

    for (let i = 0; i < matches.length; i++) {
      const { team1, team2 } = matches[i];
      const stageLabel = STAGE_LABELS[roundKey](i);
      const apiMatch = apiRound[i] || {};
      const venue = apiMatch.venue && apiMatch.venue !== 'TBD' ? apiMatch.venue : null;
      const matchDate = apiMatch.dateSgt && apiMatch.dateSgt !== 'TBD' ? apiMatch.dateSgt : null;
      const prediction = await analyzeMatch(team1, team2, stageLabel, venue, matchDate);
      results.push(prediction);

      // Persist after every match so progress survives a crash
      ko.predictions[roundKey] = roundKey === 'final' ? prediction : [...results];
      ko.predictions.analyzedAt = new Date().toISOString();
      writeJson(KNOCKOUT_FILE, ko);
    }

    notify({ type: 'round_done', round: roundKey, results });
    return results;
  }

  // ── Round of 32 (16 matches) ──
  const r32 = await analyzeRound(R32_BRACKET, 'roundOf32');

  // ── Round of 16 (8 matches — winners of R32 pairs) ──
  const r16 = await analyzeRound(buildNextRound(r32), 'roundOf16');

  // ── Quarter-Finals (4 matches) ──
  const qf = await analyzeRound(buildNextRound(r16), 'quarterFinals');

  // ── Semi-Finals (2 matches) ──
  const sf = await analyzeRound(buildNextRound(qf), 'semiFinals');

  // ── Final (1 match) ──
  const finalMatches = await analyzeRound(buildNextRound(sf), 'final');
  const finalResult = Array.isArray(finalMatches) ? finalMatches[0] : finalMatches;

  ko.predictions.final = finalResult;
  ko.predictions.champion = finalResult.winner;
  ko.champion = finalResult.winner;
  ko.predictions.analyzedAt = new Date().toISOString();
  writeJson(KNOCKOUT_FILE, ko);

  console.log(`[KNOCKOUT] Analysis complete — predicted champion: ${finalResult.winner}`);

  // Write Obsidian note (fire and forget)
  obsidianPost('/write', {
    filename: 'WC2026/knockout-predictions.md',
    content: formatBracketNote(ko.predictions),
  })
    .then(() => console.log('[OBSIDIAN] Knockout predictions note written'))
    .catch((err) => console.log('[OBSIDIAN] Write error (non-fatal):', err.message));

  // Send Telegram summary (fire and forget)
  telegramPost('/send', {
    message: formatBracketTelegram(ko.predictions),
    parse_mode: 'MarkdownV2',
  })
    .then(() => console.log('[TELEGRAM] Knockout bracket summary sent'))
    .catch((err) => console.log('[TELEGRAM] Send error (non-fatal):', err.message));

  return ko.predictions;
}

module.exports = { R32_BRACKET, analyzeKnockoutBracket, buildKnockoutPrompt };
