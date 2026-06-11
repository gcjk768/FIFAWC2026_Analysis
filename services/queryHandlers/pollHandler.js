'use strict';

const { getCache, escapeMd } = require('../chatService');

/**
 * Find a fixture by two team name fragments.
 * @param {object[]} fixtures
 * @param {string} text
 * @returns {object|null}
 */
function findFixture(fixtures, text) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  return (
    fixtures.find((f) => {
      const t1 = f.team1.toLowerCase();
      const t2 = f.team2.toLowerCase();
      return words.some((w) => t1.includes(w)) && words.some((w) => t2.includes(w));
    }) ||
    fixtures.find((f) => {
      const t1 = f.team1.toLowerCase();
      const t2 = f.team2.toLowerCase();
      return words.some((w) => t1.includes(w) || t2.includes(w));
    }) ||
    null
  );
}

/**
 * Build poll question, options, and context from a fixture + existing predictions.
 * @param {object} fixture
 * @param {object} predictions
 * @returns {{ question: string, options: string[], context: string }}
 */
function buildPollData(fixture, predictions) {
  const { team1, team2, group, dateSgt } = fixture;
  const p = predictions[fixture.matchId];

  const question = p
    ? `⚽ ${team1} vs ${team2} — Who wins?\n🔮 AI pick: ${p.winner} ${p.predicted_score} (${p.confidence}%)`
    : `⚽ ${team1} vs ${team2} — Who wins?\nGroup ${group} | ${dateSgt} SGT`;

  let context;
  if (p) {
    const scoreReason = p.score_reasoning ? `\n📐 _${escapeMd(p.score_reasoning)}_` : '';
    context = [
      `🔮 *Qwen's call:* ${escapeMd(team1)} vs ${escapeMd(team2)}`,
      `🏆 *${escapeMd(p.winner)}* ${escapeMd(p.predicted_score)} \\(${p.confidence}%\\)`,
      scoreReason,
      ``,
      `_Vote above \\— does Qwen get it right?_`,
    ].join('\n');
  } else {
    context = `_No AI prediction yet\\. Ask /predict ${escapeMd(team1)} ${escapeMd(team2)} for Qwen's analysis first\\!_`;
  }

  return {
    question: question.slice(0, 300),
    options: [`🏆 ${team1}`, `🤝 Draw`, `🏆 ${team2}`],
    context,
  };
}

/**
 * Handle /poll — returns a poll object or an error string.
 * chatbot.js detects { type: 'poll' } and calls sendPoll + sendMd.
 * @param {string} text - raw message text
 * @returns {Promise<string|object>}
 */
async function handlePoll(text) {
  const { fixtures, predictions } = await getCache();
  const query = text.replace(/^\/poll\s*/i, '').trim();

  if (!query) {
    return `❓ Specify a match: /poll Brazil Morocco`;
  }

  const fixture = findFixture(fixtures, query);
  if (!fixture) {
    return `❓ Couldn't find that match\\. Try: /poll Brazil Morocco`;
  }

  const pollData = buildPollData(fixture, predictions);

  return {
    type: 'poll',
    ...pollData,
  };
}

module.exports = { handlePoll, findFixture, buildPollData };
