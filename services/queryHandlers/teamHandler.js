'use strict';

const { getCache, callOllamaQueued, escapeMd, formatForTelegram } = require('../chatService');
const { MASTER_SYSTEM_PROMPT } = require('../qwenPersonality');

/**
 * Handle team info query.
 * @param {string} text
 */
async function handleTeamInfo(text) {
  const teamName = text.replace(/^\/(team|about|info)\s*/i, '').replace(/tell me about\s*/i, '').trim();
  if (!teamName) return `❓ Specify a team: e.g. "tell me about Brazil"`;

  const { teamStats, fixtures, predictions } = await getCache();

  // Find best match in teamStats
  const found = Object.entries(teamStats).find(([t]) =>
    t.toLowerCase().includes(teamName.toLowerCase()) ||
    teamName.toLowerCase().includes(t.toLowerCase().split(' ')[0]),
  );

  if (!found) {
    return `❓ Team not found: ${escapeMd(teamName)}\\. Check the spelling or try a different name\\.`;
  }

  const [team, stats] = found;
  const upcoming = fixtures
    .filter((f) => (f.team1 === team || f.team2 === team) && new Date(f.dateIso) > Date.now())
    .sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso))
    .slice(0, 2);

  const nextMatch = upcoming[0]
    ? `${upcoming[0].team1} vs ${upcoming[0].team2} — ${upcoming[0].dateSgt} ${upcoming[0].timeSgt} SGT`
    : 'No upcoming matches';

  const teamPreds = Object.values(predictions).filter((p) => p.team1 === team || p.team2 === team);
  const wins = teamPreds.filter((p) => p.winner === team).length;

  return [
    `🌍 *${escapeMd(team)}*`,
    ``,
    `📊 *Stats*`,
    `FIFA Rank: #${escapeMd(String(stats.rank))}`,
    `Avg Goals Scored: ${escapeMd(String(stats.goalsFor))}/game`,
    `Avg Goals Conceded: ${escapeMd(String(stats.goalsAgainst))}/game`,
    `Recent Form: \`${escapeMd(stats.form)}\``,
    ``,
    `🔮 *Predictions*`,
    `qwen picks them to win: ${wins}/${teamPreds.length} analyzed matches`,
    ``,
    `📅 *Next Match*`,
    escapeMd(nextMatch),
  ].join('\n');
}

/**
 * Handle team comparison via Qwen.
 * @param {string} text
 */
async function handleTeamCompare(text) {
  const cleaned = text.replace(/compare\s+/i, '').trim();
  const parts = cleaned.split(/\s+vs\.?\s+|\s+and\s+/i);
  const t1 = parts[0]?.trim();
  const t2 = parts[1]?.trim();

  if (!t1 || !t2) return `❓ Compare two teams: "compare Brazil vs France"`;

  const { teamStats } = await getCache();
  const s1 = teamStats[t1] || {};
  const s2 = teamStats[t2] || {};

  const prompt = `${MASTER_SYSTEM_PROMPT}

${t1}: Rank #${s1.rank || '?'} | Form: ${s1.form || '?'} | Goals/g: ${s1.goalsFor || '?'} | Conceded/g: ${s1.goalsAgainst || '?'}
${t2}: Rank #${s2.rank || '?'} | Form: ${s2.form || '?'} | Goals/g: ${s2.goalsFor || '?'} | Conceded/g: ${s2.goalsAgainst || '?'}

Compare these two teams for WC2026. Use the COMPARISON template. Give a clear verdict.`;

  const answer = await callOllamaQueued(prompt);
  return `⚖️ *${escapeMd(t1)} vs ${escapeMd(t2)}*\n\n${formatForTelegram(answer)}\n\n_Analysis by qwen3\\.5:35b_`;
}

module.exports = { handleTeamInfo, handleTeamCompare };
