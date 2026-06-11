'use strict';

require('dotenv').config({ override: true });
const fetch = require('./mcp-servers/telegram-mcp/node_modules/node-fetch');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHANNEL_ID;
const topicId = Number(process.env.TELEGRAM_TOPIC_ID);

const firstMatchDate = new Date('2026-06-12T03:00:00+08:00');

const diff = firstMatchDate - Date.now();
const days = Math.floor(diff / 86400000);
const hours = Math.floor((diff % 86400000) / 3600000);
const mins = Math.floor((diff % 3600000) / 60000);
const secs = Math.floor((diff % 60000) / 1000);
const countdown = diff > 0 ? `${days}d ${hours}h ${mins}m ${secs}s` : 'The tournament has started!';

function esc(t) {
  return String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

const msg = [
  '⚽ *FIFA WORLD CUP 2026*',
  '',
  '🏟 *Opening Match*',
  `*${esc('Mexico')}* vs *${esc('South Africa')}*`,
  `📅 12 Jun 2026, 03:00 SGT \\| Group A`,
  `📍 ${esc('SoFi Stadium, Los Angeles')}`,
  '',
  '⏳ *Countdown to Kickoff:*',
  `\`${esc(countdown)}\``,
  '',
  '_Let the games begin\\!_ 🌍',
].join('\n');

fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    text: msg,
    parse_mode: 'MarkdownV2',
    message_thread_id: topicId,
  }),
})
  .then((r) => r.json())
  .then((d) => console.log(d.ok ? `✅ Countdown sent! (${countdown})` : `❌ ${d.description}`))
  .catch((e) => console.error('Error:', e.message));
