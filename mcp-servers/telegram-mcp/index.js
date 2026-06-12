'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const { toZh } = require('../../services/countryNames');

const PORT = process.env.TELEGRAM_PORT || 3003;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID || '';
const TOPIC_ID = process.env.TELEGRAM_TOPIC_ID ? Number(process.env.TELEGRAM_TOPIC_ID) : null;

const TG_MAX_CHARS = 4086;

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
 * Build a visual confidence bar using Unicode block characters.
 * @param {number} confidence - 0 to 100
 * @param {number} [width=10]
 * @returns {string}
 */
function buildConfidenceBar(confidence, width = 10) {
  const filled = Math.round(Math.max(0, Math.min(100, confidence)) / 100 * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Return a colour circle emoji matching the risk level.
 * @param {string} risk
 * @returns {string}
 */
function riskEmoji(risk) {
  const r = (risk || '').toLowerCase();
  if (r === 'low') return '🟢';
  if (r === 'medium') return '🟡';
  if (r === 'high') return '🔴';
  return '⚪';
}

/**
 * Split a long message into Telegram-safe chunks at natural boundaries.
 * Prefers the EN/ZH section separator, then double newlines, then single newlines.
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string[]}
 */
function splitMessage(text, maxLen = TG_MAX_CHARS) {
  if (text.length <= maxLen) return [text];

  const SEAMS = ['━━━━━━━━━━━━━━━━━━━━━━━━', '\n\n', '\n'];
  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let cut = -1;
    for (const seam of SEAMS) {
      const idx = remaining.lastIndexOf(seam, maxLen);
      if (idx > maxLen * 0.35) {
        cut = idx + seam.length;
        break;
      }
    }
    if (cut === -1) cut = maxLen;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining.trim()) chunks.push(remaining.trim());
  return chunks;
}

/**
 * Send a message to Telegram.
 * @param {string} message
 * @param {string} [parseMode]
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

  if (resp.status === 429) {
    const retryAfter = parseInt(resp.headers.get('Retry-After') || '5', 10);
    const err = new Error(`Telegram rate limited — retry after ${retryAfter}s`);
    err.code = 429;
    err.retryAfter = retryAfter;
    throw err;
  }

  const data = await resp.json();
  if (!data.ok) {
    const err = new Error(`Telegram API error: ${data.description} (code ${data.error_code})`);
    err.code = data.error_code;
    throw err;
  }
  return data;
}

/**
 * Send with automatic retry — handles 429 rate limits and transient 5xx errors.
 * @param {string} message
 * @param {string} [parseMode]
 * @param {string} [chatId]
 * @param {number} [replyToMessageId]
 * @param {number} [threadId]
 * @returns {Promise<object>}
 */
async function sendTelegramRetried(message, parseMode, chatId, replyToMessageId, threadId) {
  const MAX_RETRIES = 2;
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await sendTelegram(message, parseMode, chatId, replyToMessageId, threadId);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES) break;
      if (err.code === 429) {
        const waitMs = (err.retryAfter || 5) * 1000;
        console.warn(`[TELEGRAM] Rate limited — waiting ${waitMs}ms (attempt ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, waitMs));
      } else if (String(err.code || '').startsWith('5')) {
        const waitMs = Math.pow(2, attempt) * 1500;
        console.warn(`[TELEGRAM] Server error ${err.code} — retrying in ${waitMs}ms`);
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

/**
 * Split a long message and send each part with retry.
 * @param {string} message
 * @param {string} [parseMode]
 * @param {string} [chatId]
 * @returns {Promise<number>} last message_id
 */
async function sendLong(message, parseMode, chatId) {
  const parts = splitMessage(message);
  let lastId;
  for (const part of parts) {
    const result = await sendTelegramRetried(part, parseMode, chatId);
    lastId = result.result?.message_id;
  }
  return lastId;
}

/**
 * Format a prediction object as a Telegram MarkdownV2 analysis card.
 * @param {object} prediction
 * @returns {string}
 */
function formatAnalysisCard(prediction) {
  const {
    team1, team2, group, dateSgt, venue,
    winner, predicted_score, confidence, risk_factor,
    key_factors = [], analysis_summary, score_reasoning,
    key_factors_zh, analysis_summary_zh,
  } = prediction;

  const conf = confidence || 0;
  const bar = buildConfidenceBar(conf);
  const riskIcon = riskEmoji(risk_factor);
  const div = '━━━━━━━━━━━━━━━━━━━━━━━━';
  const factorNums = ['①', '②', '③'];

  const factors = key_factors.slice(0, 3)
    .map((f, i) => `${factorNums[i] || '•'} ${escapeMd(f)}`)
    .join('\n');

  const winnerDisplay = winner === 'draw' ? 'Draw' : escapeMd(winner);

  const lines = [
    `⚽ *WC2026 MATCH ANALYSIS*`,
    div,
    `*${escapeMd(team1)}* vs *${escapeMd(team2)}*`,
    `📅 Group ${escapeMd(group)}  ·  ${escapeMd(dateSgt)} SGT`,
    ...(venue ? [`🏟 ${escapeMd(venue)}`] : []),
    div,
    ``,
    `🥇 *Winner:* ${winnerDisplay}`,
    `⚽ *Score:* ${escapeMd(predicted_score || '?-?')}`,
    `📊 *Confidence:* ${bar} ${escapeMd(String(conf))}%`,
    `${riskIcon} *Risk:* ${escapeMd((risk_factor || 'unknown').toUpperCase())}`,
    ``,
    div,
    `🔑 *KEY FACTORS*`,
    ``,
    factors,
    ``,
  ];

  if (score_reasoning) {
    lines.push(div, `📐 *SCORE REASONING*`, ``, escapeMd(score_reasoning), ``);
  }

  if (analysis_summary) {
    lines.push(div, `📋 *TACTICAL BREAKDOWN*`, ``, escapeMd(analysis_summary), ``);
  }

  lines.push(div, `_Powered by qwen3\\.6:35b via Ollama_`);

  // Chinese section — uses translated content when available, English otherwise
  const team1Zh = escapeMd(toZh(team1));
  const team2Zh = escapeMd(toZh(team2));
  const winnerZh = winner === 'draw' ? '平局' : escapeMd(toZh(winner));
  const factorsZh = (Array.isArray(key_factors_zh) && key_factors_zh.length > 0)
    ? key_factors_zh.slice(0, 3).map((f, i) => `${factorNums[i] || '•'} ${escapeMd(f)}`).join('\n')
    : factors;
  const summaryZh = analysis_summary_zh || analysis_summary;

  lines.push(
    ``,
    `🇨🇳 *世界杯2026 赛事分析*`,
    div,
    `*${team1Zh}* vs *${team2Zh}*`,
    `📅 ${escapeMd(group)}组  ·  ${escapeMd(dateSgt)} SGT`,
    ...(venue ? [`🏟 ${escapeMd(venue)}`] : []),
    div,
    ``,
    `🥇 *赢家：* ${winnerZh}`,
    `⚽ *比分：* ${escapeMd(predicted_score || '?-?')}`,
    `📊 *置信度：* ${bar} ${escapeMd(String(conf))}%`,
    `${riskIcon} *风险：* ${escapeMd((risk_factor || 'unknown').toUpperCase())}`,
    ``,
    div,
    `🔑 *关键因素*`,
    ``,
    factorsZh,
    ``,
  );

  if (summaryZh) {
    lines.push(div, `📋 *战术分析*`, ``, escapeMd(summaryZh), ``);
  }

  lines.push(div, `_qwen3\\.6:35b via Ollama 提供支持_`);

  return lines.join('\n');
}

/**
 * Format a daily digest of matches.
 * @param {object[]} matches
 * @param {string} dateSgt
 * @returns {string}
 */
function formatDigest(matches, dateSgt) {
  const div = '━━━━━━━━━━━━━━━━━━━━━━━━';

  const en = [
    `📅 *WC2026 MATCHES TODAY*`,
    `${escapeMd(dateSgt || 'Today')} SGT`,
    div,
    ``,
  ];

  const zh = [
    `🇨🇳 *世界杯2026 今日赛程*`,
    `${escapeMd(dateSgt || 'Today')} SGT`,
    div,
    ``,
  ];

  for (const m of matches) {
    if (m.suppress) continue;

    const timeStr = escapeMd(m.timeSgt || '??:??');
    const groupStr = escapeMd(m.group || '?');
    const venueStr = m.venue ? `  ·  ${escapeMd(m.venue)}` : '';

    en.push(
      `⚽ *${timeStr}* — *${escapeMd(m.team1)}* vs *${escapeMd(m.team2)}*`,
      `   📍 Group ${groupStr}${venueStr}`,
    );

    zh.push(
      `⚽ *${timeStr}* — *${escapeMd(toZh(m.team1))}* vs *${escapeMd(toZh(m.team2))}*`,
      `   📍 ${groupStr}组${venueStr}`,
    );

    if (m.prediction) {
      const c = escapeMd(String(m.prediction.confidence || 0));
      const miniBar = buildConfidenceBar(m.prediction.confidence || 0, 6);
      const w = m.prediction.winner === 'draw'
        ? 'Draw'
        : escapeMd(m.prediction.winner || '');
      const wZh = m.prediction.winner === 'draw'
        ? '平局'
        : escapeMd(toZh(m.prediction.winner || ''));
      const scoreStr = escapeMd(m.prediction.predicted_score || '');

      en.push(`   🏆 ${w}  ${scoreStr}  ${miniBar} ${c}%`);
      zh.push(`   🏆 ${wZh}  ${scoreStr}  ${miniBar} ${c}%`);
    }

    en.push('');
    zh.push('');
  }

  en.push(div, `_All times Singapore Time \\(SGT\\)_`);
  zh.push(div, `_所有时间均为新加坡时间 \\(SGT\\)_`);

  return [...en, ``, `─────────────────────────`, ...zh].join('\n');
}

/** POST /send — plain or MarkdownV2 message, auto-split if > 4086 chars */
app.post('/send', async (req, res) => {
  const { message, parse_mode } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const parts = splitMessage(message);
    let lastMsgId;
    for (const part of parts) {
      const result = await sendTelegramRetried(part, parse_mode || 'MarkdownV2');
      lastMsgId = result.result?.message_id;
    }
    console.log(`[TELEGRAM] Sent message (${message.length} chars, ${parts.length} part${parts.length > 1 ? 's' : ''})`);
    res.json({ success: true, messageId: lastMsgId, parts: parts.length });
  } catch (err) {
    console.error('[TELEGRAM] send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /send-analysis — format + send a full match analysis, split if needed */
app.post('/send-analysis', async (req, res) => {
  try {
    const text = formatAnalysisCard(req.body);
    const lastMsgId = await sendLong(text, 'MarkdownV2');
    console.log(`[TELEGRAM] Sent analysis: ${req.body.team1} vs ${req.body.team2}`);
    res.json({ success: true, messageId: lastMsgId });
  } catch (err) {
    console.error('[TELEGRAM] send-analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /send-digest — send daily match digest, split if needed */
app.post('/send-digest', async (req, res) => {
  try {
    const { matches = [], dateSgt } = req.body;
    const text = formatDigest(matches, dateSgt);
    const lastMsgId = await sendLong(text, 'MarkdownV2');
    console.log(`[TELEGRAM] Sent digest with ${matches.length} matches`);
    res.json({ success: true, messageId: lastMsgId });
  } catch (err) {
    console.error('[TELEGRAM] send-digest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /test — send a test message to verify bot + channel are working */
app.post('/test', async (req, res) => {
  const { message } = req.body;
  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  const testMsg = message
    || `🧪 *WC2026 Bot Test*\n${escapeMd(now)} SGT\n_Token and channel configured correctly\\._`;
  try {
    const result = await sendTelegramRetried(testMsg, 'MarkdownV2');
    console.log('[TELEGRAM] Test message sent');
    res.json({ success: true, messageId: result.result?.message_id });
  } catch (err) {
    console.error('[TELEGRAM] Test failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /health — checks token, channel, and bot connectivity via getMe */
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    tokenSet: !!BOT_TOKEN,
    channelSet: !!CHANNEL_ID,
    channel: CHANNEL_ID ? CHANNEL_ID.slice(0, -4) + '****' : 'NOT SET',
    topicId: TOPIC_ID ?? 'NOT SET',
    bot: null,
  };

  if (BOT_TOKEN) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, { timeout: 5000 });
      const data = await resp.json();
      if (data.ok) {
        health.bot = {
          id: data.result.id,
          username: data.result.username,
          firstName: data.result.first_name,
        };
      } else {
        health.status = 'degraded';
        health.botError = data.description;
      }
    } catch (err) {
      health.status = 'degraded';
      health.botError = err.message;
    }
  } else {
    health.status = 'degraded';
  }

  res.json(health);
});

app.listen(PORT, () => {
  console.log(`[TELEGRAM] MCP sender running on port ${PORT}`);
  console.log(`[TELEGRAM] Channel: ${CHANNEL_ID ? '***configured***' : 'NOT SET'}`);
});
