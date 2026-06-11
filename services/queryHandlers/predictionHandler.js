'use strict';

const fetch = require('node-fetch');
const { getCache, callOllamaQueued, escapeMd, formatForTelegram } = require('../chatService');
const { MASTER_SYSTEM_PROMPT } = require('../qwenPersonality');

const SERVER_URL = `http://localhost:${process.env.PORT || 3001}`;

/**
 * Find a fixture by two team name fragments from user text.
 * @param {object[]} fixtures
 * @param {string} text
 * @returns {object|null}
 */
function findFixture(fixtures, text) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  return fixtures.find((f) => {
    const t1 = f.team1.toLowerCase();
    const t2 = f.team2.toLowerCase();
    const matchT1 = words.some((w) => t1.includes(w));
    const matchT2 = words.some((w) => t2.includes(w));
    return matchT1 && matchT2;
  }) || fixtures.find((f) => {
    const t1 = f.team1.toLowerCase();
    const t2 = f.team2.toLowerCase();
    return words.some((w) => t1.includes(w) || t2.includes(w));
  }) || null;
}

/**
 * Format a confidence bar.
 * @param {number} confidence
 * @returns {string}
 */
function confBar(confidence) {
  const filled = Math.round(confidence / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/**
 * Format a full prediction card for chatbot output (MarkdownV2).
 * @param {object} fixture
 * @param {object} p - prediction object
 * @param {string} label - e.g. "Prediction" or "Fresh Prediction"
 * @returns {string}
 */
function formatPredictionCard(fixture, p, label) {
  const factors = (p.key_factors || []).slice(0, 3).map((f) => `• ${escapeMd(f)}`).join('\n');
  const scoreReason = p.score_reasoning
    ? [``, `📐 *Why this score:* ${escapeMd(p.score_reasoning)}`]
    : [];
  const analysis = p.analysis_summary
    ? [``, `📝 *Tactical breakdown:* ${escapeMd(p.analysis_summary)}`]
    : [];

  // Agent votes block (only shown if full-mode ran)
  const agentVotes = p.agentVotes || p.agent_votes;
  const votesBlock = agentVotes ? [
    ``,
    `🤖 *Agent Consensus:*`,
    `• 📊 Stats model: ${escapeMd(String(agentVotes.statXG ? fixture.team1 + ' xG ' + agentVotes.statXG.team1 + ' vs ' + agentVotes.statXG.team2 : agentVotes.statistical || '-'))}`,
    `• ⚽ Tactical: ${escapeMd(String(agentVotes.tactical || '-'))}`,
    `• 📖 Historical: ${escapeMd(String(agentVotes.historical || '-'))}`,
    `• 🧠 Motivation: ${escapeMd(String(agentVotes.psychological || '-'))}`,
    p.devil_upset_pct !== undefined ? `• ⚠️ Upset risk: ${escapeMd(String(p.devil_upset_pct))}% ${p.devil_upset_scenario ? '\\— ' + escapeMd(p.devil_upset_scenario) : ''}` : '',
  ].filter(Boolean) : [];

  const modeTag = p.analysisMode === 'full' ? ' \\(5\\-agent\\)' : p.analysisMode === 'fast' ? ' \\(fast\\)' : '';

  return [
    `🔮 *${escapeMd(fixture.team1)} vs ${escapeMd(fixture.team2)} — ${escapeMd(label)}*`,
    `Group ${escapeMd(fixture.group)} \\| ${escapeMd(fixture.dateSgt)}, ${escapeMd(fixture.timeSgt)} SGT`,
    ``,
    `🏆 *Winner: ${escapeMd(String(p.winner))}*`,
    `📊 Score: *${escapeMd(p.predicted_score || '?-?')}*`,
    `📈 Confidence: ${escapeMd(String(p.confidence || 0))}% ${escapeMd(confBar(p.confidence || 0))}`,
    `⚠️ Risk: ${escapeMd(p.risk_factor || 'unknown')}`,
    ``,
    `🔑 *Key Factors:*`,
    factors,
    ...scoreReason,
    ...analysis,
    ...votesBlock,
    ``,
    `_Powered by qwen3\\.6:35b${modeTag}_`,
  ].join('\n');
}

/**
 * Handle prediction for two teams.
 * @param {string} text
 */
async function handlePrediction(text) {
  const { fixtures, predictions } = await getCache();
  const fixture = findFixture(fixtures, text);

  if (!fixture) {
    return `❓ Couldn't identify the match\\. Try: /predict Brazil Morocco`;
  }

  // Use cached prediction if available
  if (predictions[fixture.matchId]) {
    const p = predictions[fixture.matchId];
    return formatPredictionCard(fixture, p, 'Prediction');
  }

  // Trigger analysis — fast mode for chatbot responsiveness (~2-4 min vs 8+ min for full)
  try {
    const resp = await fetch(`${SERVER_URL}/api/analyze/${fixture.matchId}?mode=fast`, {
      method: 'POST',
      timeout: 300000,
    });
    if (resp.ok) {
      const p = await resp.json();
      return formatPredictionCard(fixture, p, 'Fresh Prediction');
    }
  } catch (err) {
    console.error('[CHATBOT] Prediction trigger error:', err.message);
  }

  return `❌ Could not run prediction for ${escapeMd(fixture.team1)} vs ${escapeMd(fixture.team2)}\\. Is Ollama running?`;
}

/**
 * Handle "who will win the World Cup?" type questions.
 */
async function handleTournamentWinner() {
  const { teamStats } = await getCache();
  const top8 = Object.entries(teamStats)
    .sort((a, b) => a[1].rank - b[1].rank)
    .slice(0, 8)
    .map(([t, s]) => `${t} (rank #${s.rank}, form: ${s.form})`)
    .join('\n');

  const prompt = `${MASTER_SYSTEM_PROMPT}

TOP TEAMS BY FIFA RANKING & FORM:
${top8}

Who will win WC2026? Pick your top 4 with one-line reasons each.
Use the GENERAL/ASK template. Be bold and decisive.`;

  const answer = await callOllamaQueued(prompt);
  return `🏆 *Who Will Win WC2026?*\n\n${formatForTelegram(answer)}\n\n_Analysis by qwen3\\.5:35b_`;
}

/**
 * Handle all predictions for a group.
 * @param {string} text
 */
async function handleGroupPredictions(text) {
  const { fixtures, predictions } = await getCache();
  const match = text.match(/\b([a-lA-L])\b/);
  const group = match ? match[1].toUpperCase() : null;
  if (!group) return `❓ Specify a group: /group A through /group L`;

  const groupFixtures = fixtures.filter((f) => f.group === group);
  if (groupFixtures.length === 0) return `❓ Group ${group} not found\\.`;

  const lines = [`🔮 *Group ${group} — All Predictions*`, ``];
  for (const f of groupFixtures) {
    const p = predictions[f.matchId];
    if (p) {
      lines.push(`⚽ ${escapeMd(f.team1)} vs ${escapeMd(f.team2)}: *${escapeMd(p.winner)}* ${escapeMd(p.predicted_score)} \\(${p.confidence}%\\)`);
    } else {
      lines.push(`⚽ ${escapeMd(f.team1)} vs ${escapeMd(f.team2)}: _not analyzed yet_`);
    }
  }
  lines.push(`\n_Powered by qwen3\\.5:35b_`);
  return lines.join('\n');
}

// WC2026 group composition for knockout round prediction prompts
const WC2026_GROUPS = [
  'Group A: Mexico, South Africa, South Korea, Czechia',
  'Group B: Canada, Switzerland, Qatar, Bosnia',
  'Group C: Brazil, Morocco, Haiti, Scotland',
  'Group D: USA, Paraguay, Australia, Turkiye',
  'Group E: Germany, Curacao, Ivory Coast, Ecuador',
  'Group F: Netherlands, Japan, Sweden, Tunisia',
  'Group G: Belgium, Egypt, Iran, New Zealand',
  'Group H: Spain, Cape Verde, Saudi Arabia, Uruguay',
  'Group I: France, Senegal, Norway, Iraq',
  'Group J: Argentina, Algeria, Austria, Jordan',
  'Group K: Portugal, DR Congo, Uzbekistan, Colombia',
  'Group L: England, Croatia, Ghana, Panama',
].join('\n');

/**
 * Detect which knockout round is being asked about.
 * @param {string} t - lowercased text
 * @returns {{ roundName: string, matchCount: number, dates: string }}
 */
function detectKnockoutRound(t) {
  if (t.match(/semi/)) return { roundName: 'Semi-Finals', matchCount: 2, dates: 'Jul 13–14' };
  if (t.match(/quarter|quart/)) return { roundName: 'Quarter-Finals', matchCount: 4, dates: 'Jul 8–9' };
  if (t.match(/\b16\b|sixteen|round of 16/)) return { roundName: 'Round of 16', matchCount: 8, dates: 'Jul 3–5' };
  return { roundName: 'Round of 32', matchCount: 16, dates: 'Jun 28 – Jul 1' };
}

/**
 * Handle predictions for a full knockout round (all matches).
 * @param {string} text
 */
async function handleKnockoutRoundPrediction(text) {
  const t = text.toLowerCase();
  const { roundName, matchCount, dates } = detectKnockoutRound(t);

  const prompt = `${MASTER_SYSTEM_PROMPT}

━━━ WC2026 DATA ━━━
TOURNAMENT: FIFA World Cup 2026 — 48 teams, 12 groups, 104 matches
FORMAT: Top 2 from each group (24 teams) + 8 best 3rd-place finishers = 32 teams in Round of 32

GROUPS:
${WC2026_GROUPS}
━━━ END DATA ━━━

USER: Predict ALL ${matchCount} ${roundName} matches (${dates}).

INSTRUCTIONS:
- First state the most likely 32 qualifiers (1 line: Group + Winner + Runner-up)
- Then list ALL ${matchCount} ${roundName} matchups with your pick
- Format each: • *[Winner]* def [Loser] [X:X] — [one reason]
- Use scores with ":" separator (e.g. 2:1)
- You MUST predict exactly ${matchCount} matches. Do not stop early.
- After all matches, add "📝 *Bottom line*:" with a 1-sentence verdict

Use the GENERAL/ASK template heading: 🧠 *${roundName} Prediction* (${dates})`;

  const answer = await callOllamaQueued(prompt, false, 2500);
  return formatForTelegram(answer) || '❓ Could not generate round prediction.';
}

module.exports = { handlePrediction, handleTournamentWinner, handleGroupPredictions, handleKnockoutRoundPrediction };
