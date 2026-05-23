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
    const factors = (p.key_factors || []).slice(0, 3).map((f) => `• ${escapeMd(f)}`).join('\n');
    return [
      `🔮 *${escapeMd(fixture.team1)} vs ${escapeMd(fixture.team2)} — Prediction*`,
      `Group ${fixture.group} \\| ${escapeMd(fixture.dateSgt)}, ${escapeMd(fixture.timeSgt)} SGT`,
      ``,
      `🏆 Winner: *${escapeMd(p.winner)}*`,
      `📊 Score: *${escapeMd(p.predicted_score || '?-?')}*`,
      `📈 Confidence: ${escapeMd(String(p.confidence || 0))}% ${escapeMd(confBar(p.confidence || 0))}`,
      `⚠️ Risk: ${escapeMd(p.risk_factor || 'unknown')}`,
      ``,
      `🔑 *Key Factors:*`,
      factors,
      ``,
      `📝 ${escapeMd(p.analysis_summary || '')}`,
      ``,
      `_Powered by qwen3\\.5:35b_`,
    ].join('\n');
  }

  // Trigger analysis
  try {
    const resp = await fetch(`${SERVER_URL}/api/analyze/${fixture.matchId}`, {
      method: 'POST',
      timeout: 180000,
    });
    if (resp.ok) {
      const p = await resp.json();
      const factors = (p.key_factors || []).slice(0, 3).map((f) => `• ${escapeMd(f)}`).join('\n');
      return [
        `🔮 *${escapeMd(fixture.team1)} vs ${escapeMd(fixture.team2)} — Fresh Prediction*`,
        `Group ${fixture.group} \\| ${escapeMd(fixture.dateSgt)}, ${escapeMd(fixture.timeSgt)} SGT`,
        ``,
        `🏆 Winner: *${escapeMd(p.winner)}*`,
        `📊 Score: *${escapeMd(p.predicted_score || '?-?')}*`,
        `📈 Confidence: ${escapeMd(String(p.confidence || 0))}%`,
        `⚠️ Risk: ${escapeMd(p.risk_factor || 'unknown')}`,
        ``,
        `🔑 *Key Factors:*`,
        factors,
        ``,
        `📝 ${escapeMd(p.analysis_summary || '')}`,
        ``,
        `_Powered by qwen3\\.5:35b_`,
      ].join('\n');
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

module.exports = { handlePrediction, handleTournamentWinner, handleGroupPredictions };
