'use strict';

const { getChatHistory, buildFullContext, callOllamaQueued, formatForTelegram } = require('../chatService');
const { MASTER_SYSTEM_PROMPT } = require('../qwenPersonality');

/**
 * Handle any question by sending it to Qwen with lean context.
 * @param {string} text
 * @param {string|number} chatId
 * @returns {Promise<string>}
 */
async function handle(text, chatId) {
  const history = getChatHistory(chatId, 3);
  const context = await buildFullContext();

  const historyStr = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.text}`)
    .join('\n');

  const prompt = `${MASTER_SYSTEM_PROMPT}

━━━ WC2026 DATA ━━━
${context}
━━━ END DATA ━━━
${historyStr ? `\nRECENT CHAT:\n${historyStr}\n` : ''}
USER: ${text}

Use the GENERAL/ASK template. Answer directly.`;

  const answer = await callOllamaQueued(prompt);
  return formatForTelegram(answer) || '❓ No response — try rephrasing your question.';
}

module.exports = { handle };
