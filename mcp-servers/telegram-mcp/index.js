'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.TELEGRAM_PORT || 3003;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID || '';
const TOPIC_ID = process.env.TELEGRAM_TOPIC_ID ? Number(process.env.TELEGRAM_TOPIC_ID) : null;

/**
 * Escape special characters for Telegram MarkdownV2.
 * @param {string} text
 * @returns {string}
 */
function escapeMd(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

/**
 * Send a message to Telegram.
 * @param {string} message
 * @param {string} parseMode
 * @param {string} [chatId]
 * @param {number} [replyToMessageId]
 * @param {number} [threadId]
 * @returns {Promise<object>}
 */
async function sendTelegram(message, parseMode = 'MarkdownV2', chatId, replyToMessageId, threadId) {
  const target = chatId || CHANNEL_ID;
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
  if (!target) throw new Error('TELEGRAM_CHANNEL_ID / TELEGRAM_CHAT_ID not set');

  const payload = {
    chat_id: target,
    text: message,
    parse_mode: parseMode,
  };
  if (threadId ?? TOPIC_ID) payload.message_thread_id = threadId ?? TOPIC_ID;
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;

  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();
  if (!data.ok) throw new Error(`Telegram API error: ${data.description} (code ${data.error_code})`);
  return data;
}

/**
 * Format a prediction object as a Telegram MarkdownV2 analysis card.
 * @param {object} prediction
 * @returns {string}
 */
function formatAnalysisCard(prediction) {
  const {
    team1, team2, group, dateSgt,
    winner, predicted_score, confidence, risk_factor,
    key_factors = [], analysis_summary,
  } = prediction;

  const factors = key_factors.slice(0, 3).map((f) => `• ${escapeMd(f)}`).join('\n');

  return [
    `⚽ *WC2026 MATCH ANALYSIS*`,
    ``,
    `🏟 *${escapeMd(team1)} vs ${escapeMd(team2)}*`,
    `📅 ${escapeMd(dateSgt)} SGT \\| Group ${escapeMd(group)}`,
    ``,
    `🏆 *Predicted Winner:* ${escapeMd(winner)}`,
    `📊 *Score:* ${escapeMd(predicted_score || '?-?')}`,
    `📈 *Confidence:* ${escapeMd(String(confidence || 0))}%`,
    `⚠️ *Risk:* ${escapeMd(risk_factor || 'unknown')}`,
    ``,
    `🔑 *Key Factors:*`,
    factors,
    ``,
    `📝 ${escapeMd(analysis_summary || '')}`,
    ``,
    `_Powered by qwen3\\.5:35b via Ollama_`,
  ].join('\n');
}

/**
 * Format a daily digest of matches.
 * @param {object[]} matches
 * @param {string} dateSgt
 * @returns {string}
 */
function formatDigest(matches, dateSgt) {
  const lines = [`📅 *WC2026 Matches Today — ${escapeMd(dateSgt || 'Today')} SGT*`, ``];

  for (const m of matches) {
    if (m.suppress) continue;
    lines.push(`⚽ ${escapeMd(m.timeSgt || '??:??')} SGT — *${escapeMd(m.team1)}* vs *${escapeMd(m.team2)}* \\| Group ${escapeMd(m.group)}`);
    lines.push(`   🏟 ${escapeMd(m.venue || '')}`);
    if (m.prediction) {
      const c = escapeMd(String(m.prediction.confidence || 0));
      lines.push(`   🏆 ${escapeMd(m.prediction.winner || '')} ${escapeMd(m.prediction.predicted_score || '')} \\(${c}%\\)`);
    }
    lines.push('');
  }

  lines.push(`_All times Singapore Time \\(SGT\\)_`);
  return lines.join('\n');
}

/** POST /send */
app.post('/send', async (req, res) => {
  const { message, parse_mode } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const result = await sendTelegram(message, parse_mode || 'MarkdownV2');
    console.log(`[TELEGRAM] Sent message (${message.length} chars)`);
    res.json({ success: true, messageId: result.result?.message_id });
  } catch (err) {
    console.error('[TELEGRAM] send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /send-analysis */
app.post('/send-analysis', async (req, res) => {
  try {
    const text = formatAnalysisCard(req.body);
    const result = await sendTelegram(text, 'MarkdownV2');
    console.log(`[TELEGRAM] Sent analysis: ${req.body.team1} vs ${req.body.team2}`);
    res.json({ success: true, messageId: result.result?.message_id });
  } catch (err) {
    console.error('[TELEGRAM] send-analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /send-digest */
app.post('/send-digest', async (req, res) => {
  try {
    const { matches = [], dateSgt } = req.body;
    const text = formatDigest(matches, dateSgt);
    const result = await sendTelegram(text, 'MarkdownV2');
    console.log(`[TELEGRAM] Sent digest with ${matches.length} matches`);
    res.json({ success: true, messageId: result.result?.message_id });
  } catch (err) {
    console.error('[TELEGRAM] send-digest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /health */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    tokenSet: !!BOT_TOKEN,
    channelSet: !!CHANNEL_ID,
    channel: CHANNEL_ID ? CHANNEL_ID.slice(0, -4) + '****' : 'NOT SET',
    topicId: TOPIC_ID ?? 'NOT SET',
  });
});

app.listen(PORT, () => {
  console.log(`[TELEGRAM] MCP sender running on port ${PORT}`);
  console.log(`[TELEGRAM] Channel: ${CHANNEL_ID ? '***configured***' : 'NOT SET'}`);
});
