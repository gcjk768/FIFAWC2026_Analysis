'use strict';

require('dotenv').config({ override: true });

const fetch = require('node-fetch');
const { classifyAndHandle } = require('./services/intentService');
const { saveToHistory, checkRateLimit, refreshCache, getQueueDepth } = require('./services/chatService');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '';
const TOPIC_ID = process.env.TELEGRAM_TOPIC_ID ? Number(process.env.TELEGRAM_TOPIC_ID) : null;
const PERSONAL_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const MAX_RESPONSE_MS = Number(process.env.MAX_RESPONSE_TIME_MS) || 45000;

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────

/**
 * Send a message to a chat, optionally in a thread.
 * @param {string|number} chatId
 * @param {string} text
 * @param {number} [replyToMsgId]
 * @param {number} [threadId]
 */
async function sendMessage(chatId, text, replyToMsgId, threadId) {
  const payload = {
    chat_id: chatId,
    text: text.slice(0, 4096),
    parse_mode: undefined, // plain text — Qwen output is freeform
  };
  if (replyToMsgId) payload.reply_to_message_id = replyToMsgId;
  if (threadId) payload.message_thread_id = threadId;

  const resp = await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!data.ok) console.error('[CHATBOT] sendMessage error:', data.description);
  return data;
}

/**
 * Send MarkdownV2 message.
 */
async function sendMd(chatId, text, replyToMsgId, threadId) {
  const payload = {
    chat_id: chatId,
    text: text.slice(0, 4096),
    parse_mode: 'MarkdownV2',
  };
  if (replyToMsgId) payload.reply_to_message_id = replyToMsgId;
  if (threadId) payload.message_thread_id = threadId;

  const resp = await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  // Fallback to plain text if MarkdownV2 parsing fails
  if (!data.ok && data.description?.includes('parse')) {
    return sendMessage(chatId, text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, ''), replyToMsgId, threadId);
  }
  return data;
}

/**
 * Keep sending typing action every 4s until stop() is called.
 * @param {string|number} chatId
 * @param {number} [threadId]
 * @returns {{ stop: Function }}
 */
function startTyping(chatId, threadId) {
  const send = () => {
    const p = { chat_id: chatId, action: 'typing' };
    if (threadId) p.message_thread_id = threadId;
    fetch(`${TG_API}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).catch(() => {});
  };
  send();
  const iv = setInterval(send, 4000);
  return { stop: () => clearInterval(iv) };
}

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────

let botId = null;

/**
 * Determine if the bot should respond to a message.
 * @param {object} msg
 * @param {string} botUsername
 * @returns {boolean}
 */
function shouldRespond(msg, botUsername) {
  if (!msg?.text) return false;
  if (msg.from?.is_bot) return false;
  // Ignore messages older than 5 minutes (stale on restart)
  if (Date.now() / 1000 - msg.date > 300) return false;

  // Always respond to private chats
  if (msg.chat.type === 'private') return true;

  // Respond in the configured topic
  if (TOPIC_ID && msg.message_thread_id === TOPIC_ID) return true;

  // Respond to @mentions
  if (botUsername && msg.text.includes(`@${botUsername}`)) return true;

  return false;
}

/**
 * Process a single Telegram message.
 * @param {object} msg
 * @param {string} botUsername
 */
async function handleMessage(msg, botUsername) {
  const chatId = String(msg.chat.id);
  const threadId = msg.message_thread_id || null;
  const msgId = msg.message_id;
  const userId = msg.from?.id;
  const username = msg.from?.username || msg.from?.first_name || 'User';

  // Strip bot mention from text
  const rawText = (msg.text || '').replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
  if (!rawText) return;

  console.log(`[CHATBOT] @${username} (${chatId}): ${rawText.slice(0, 80)}`);
  saveToHistory(chatId, 'user', rawText);

  // Determine if this needs Qwen (rate limit applies)
  const isQuickCommand = /^\/?(today|tomorrow|schedule|groups?|standings|topscorers|stats|bracket|help|start)\b/i.test(rawText);
  const needsQwen = !isQuickCommand;

  if (needsQwen && !checkRateLimit(userId)) {
    await sendMessage(chatId, '🤖 Qwen is busy — you\'ve hit the limit of 10 AI questions per 5 minutes. Take a breather and try again shortly! ⚽\n🤖 Qwen 太忙了，你已达到每5分钟10个AI问题的上限，稍等片刻再试试吧！\n\nTip: /today /help for instant info without AI.', msgId, threadId);
    return;
  }

  // Notify queue position if Qwen is busy
  if (needsQwen) {
    const depth = getQueueDepth();
    if (depth > 0) {
      await sendMessage(chatId,
        `🕐 ${depth} question${depth > 1 ? 's' : ''} ahead of you — your question is queued.\n🕐 前面有 ${depth} 个问题，你的问题已排队，请稍候。`,
        msgId, threadId);
    }
  }

  const typing = startTyping(chatId, threadId);

  try {
    // Warn after 20s, then again at 75s — qwen3.5:35b can take up to 3min
    let warnSent = false;
    const warnTimer = setTimeout(async () => {
      if (needsQwen) {
        warnSent = true;
        await sendMessage(chatId, '⏳ qwen is thinking... / qwen正在思考中...', msgId, threadId);
      }
    }, 20000);
    const warnTimer2 = setTimeout(async () => {
      if (needsQwen && warnSent) {
        await sendMessage(chatId, '🧠 Still generating... almost there!', msgId, threadId);
      }
    }, 75000);

    const response = await classifyAndHandle(msg, chatId);
    clearTimeout(warnTimer);
    clearTimeout(warnTimer2);
    typing.stop();

    if (!response) {
      await sendMessage(chatId, '❌ No response generated. Try again.', msgId, threadId);
      return;
    }

    // Try MarkdownV2 first (for formatted responses), fall back to plain
    await sendMd(chatId, response, msgId, threadId);
    saveToHistory(chatId, 'bot', response.slice(0, 300));
    console.log(`[CHATBOT] Replied to @${username} (${response.length} chars)`);
  } catch (err) {
    typing.stop();
    console.error(`[CHATBOT] handleMessage error: ${err.message}`);

    if (err.message.includes('Ollama') || err.message.includes('fetch') || err.message.includes('ECONNREFUSED')) {
      await sendMessage(chatId, '🔴 qwen is offline right now. Check back soon!\n\nTry /today or /help for quick info.', msgId, threadId);
    } else {
      await sendMessage(chatId, '❌ Something went wrong. Try again.', msgId, threadId);
    }
  }
}

// ─── BOT SETUP ────────────────────────────────────────────────────────────────

/**
 * Register bot commands with BotFather.
 */
async function registerCommands() {
  const commands = [
    { command: 'squad', description: 'Full squad: /squad Argentina' },
    { command: 'today', description: "Today's matches in SGT" },
    { command: 'tomorrow', description: "Tomorrow's matches in SGT" },
    { command: 'predict', description: 'Get prediction: /predict Brazil Morocco' },
    { command: 'lineup', description: 'Expected lineup: /lineup France' },
    { command: 'injury', description: 'Injury news: /injury Germany' },
    { command: 'group', description: 'Group standings: /group C' },
    { command: 'player', description: 'Player info: /player Mbappe' },
    { command: 'topscorers', description: 'Tournament top scorers' },
    { command: 'standings', description: 'All group standings' },
    { command: 'compare', description: 'Compare: /compare Mbappe Vinicius' },
    { command: 'nextmatch', description: 'Upcoming matches' },
    { command: 'result', description: 'Latest result: /result Brazil' },
    { command: 'ask', description: 'Ask qwen anything: /ask who will win?' },
    { command: 'stats', description: 'Tournament stats summary' },
    { command: 'help', description: 'Show all commands' },
  ];

  const resp = await fetch(`${TG_API}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  const data = await resp.json();
  console.log(`[CHATBOT] Commands registered: ${data.ok ? '✓' : '✗ ' + data.description}`);
}

// ─── POLLING LOOP ────────────────────────────────────────────────────────────

/**
 * Get the bot's username.
 * @returns {Promise<string>}
 */
async function getBotUsername() {
  const resp = await fetch(`${TG_API}/getMe`);
  const data = await resp.json();
  botId = data.result?.id;
  return data.result?.username || '';
}

/**
 * Long-poll Telegram for updates.
 */
async function startPolling() {
  if (!BOT_TOKEN) {
    console.error('[CHATBOT] No TELEGRAM_BOT_TOKEN set — chatbot cannot start');
    return;
  }

  // Clear any webhook so polling works
  await fetch(`${TG_API}/deleteWebhook`).catch(() => {});

  const botUsername = await getBotUsername();
  console.log(`[CHATBOT] Polling mode active — @${botUsername}`);
  console.log(`[CHATBOT] Listening in topic ${TOPIC_ID} of channel ${CHANNEL_ID}`);
  console.log(`[CHATBOT] Also responding to DMs on @${botUsername}`);

  await registerCommands();

  let offset = 0;
  let active = true;

  process.on('SIGTERM', () => { active = false; });
  process.on('SIGINT', () => { active = false; });

  while (active) {
    try {
      const url = `${TG_API}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message"]`;
      const resp = await fetch(url, { timeout: 40000 });
      const data = await resp.json();

      if (!data.ok) {
        console.error('[CHATBOT] getUpdates error:', data.description);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      for (const update of data.result || []) {
        offset = update.update_id + 1;
        if (update.message && shouldRespond(update.message, botUsername)) {
          handleMessage(update.message, botUsername).catch((e) =>
            console.error('[CHATBOT] Unhandled error:', e.message),
          );
        }
      }
    } catch (err) {
      console.error('[CHATBOT] Poll error:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ─── STARTUP ─────────────────────────────────────────────────────────────────

/**
 * Send a startup message to the FIFAWC2026 topic.
 */
async function sendStartupMessage() {
  if (!CHANNEL_ID) return;
  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  const text = `🟢 WC2026 Bot online — ${now} SGT\nqwen3.5:35b ready. Type /help for commands.`;
  try {
    await sendMessage(CHANNEL_ID, text, null, TOPIC_ID);
    console.log('[CHATBOT] Startup message sent');
  } catch (err) {
    console.error('[CHATBOT] Startup message error:', err.message);
  }
}

async function start() {
  console.log('[CHATBOT] WC2026 qwen3.5:35b Chatbot starting...');

  // Pre-warm data cache (server might not be ready yet — retry)
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      await refreshCache();
      console.log('[CHATBOT] Data cache loaded');
      break;
    } catch {
      console.log(`[CHATBOT] Waiting for server... (${i + 1}/5)`);
    }
  }

  await sendStartupMessage();
  await startPolling();
}

start().catch((err) => console.error('[CHATBOT] Fatal error:', err.message));
