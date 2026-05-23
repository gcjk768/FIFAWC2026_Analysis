'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:35b';
const SERVER_URL = `http://localhost:${process.env.PORT || 3001}`;
const OBSIDIAN_MCP = 'http://localhost:3002';
const CHAT_HISTORY_FILE = path.join(__dirname, '../data/chat-history.json');
const MAX_RESPONSE_MS = Number(process.env.MAX_RESPONSE_TIME_MS) || 45000;

// ─── DATA CACHE ───────────────────────────────────────────────────────────────

let cache = { fixtures: [], teamStats: {}, predictions: {}, results: {}, lastRefresh: 0 };

/**
 * Refresh local data cache from server API (max once every 5 minutes).
 */
async function refreshCache() {
  if (Date.now() - cache.lastRefresh < 300000) return;
  try {
    const [fx, ts, pred, res] = await Promise.all([
      fetch(`${SERVER_URL}/api/matches`, { timeout: 5000 }).then((r) => r.json()).catch(() => []),
      fetch(`${SERVER_URL}/api/teams`, { timeout: 5000 }).then((r) => r.json()).catch(() => ({})),
      fetch(`${SERVER_URL}/api/predictions`, { timeout: 5000 }).then((r) => r.json()).catch(() => ({})),
      fetch(`${SERVER_URL}/api/results`, { timeout: 5000 }).then((r) => r.json()).catch(() => ({})),
    ]);
    cache = { fixtures: fx || [], teamStats: ts || {}, predictions: pred || {}, results: res || {}, lastRefresh: Date.now() };
  } catch (err) {
    console.error('[CHATBOT] Cache refresh error:', err.message);
  }
}

/** @returns {{ fixtures: object[], teamStats: object, predictions: object, results: object }} */
async function getCache() {
  await refreshCache();
  return cache;
}

// ─── CHAT HISTORY ─────────────────────────────────────────────────────────────

/**
 * Read chat-history.json safely.
 * @returns {object}
 */
function readHistory() {
  try {
    if (!fs.existsSync(CHAT_HISTORY_FILE)) return {};
    return JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Get last N messages for a chat.
 * @param {string|number} chatId
 * @param {number} n
 * @returns {Array<{ role: string, text: string }>}
 */
function getChatHistory(chatId, n = 5) {
  const all = readHistory();
  return (all[String(chatId)] || []).slice(-n);
}

/**
 * Save a message to chat history (max 50 per chat, atomic write).
 * @param {string|number} chatId
 * @param {'user'|'bot'} role
 * @param {string} text
 */
function saveToHistory(chatId, role, text) {
  const all = readHistory();
  const key = String(chatId);
  if (!all[key]) all[key] = [];
  all[key].push({ role, text: text.slice(0, 500), ts: Date.now() });
  if (all[key].length > 50) all[key] = all[key].slice(-50);
  const tmp = CHAT_HISTORY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, CHAT_HISTORY_FILE);
}

// ─── RATE LIMITING ────────────────────────────────────────────────────────────

const rateLimitMap = new Map();

/**
 * Check if a user has exceeded their qwen query rate limit (10 per 5min).
 * @param {string|number} userId
 * @returns {boolean} true if allowed
 */
function checkRateLimit(userId) {
  const key = String(userId);
  const now = Date.now();
  const window = 300000;
  const max = 10;

  const entry = rateLimitMap.get(key) || { count: 0, reset: now + window };
  if (now > entry.reset) {
    rateLimitMap.set(key, { count: 1, reset: now + window });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  rateLimitMap.set(key, entry);
  return true;
}

// ─── OLLAMA ───────────────────────────────────────────────────────────────────

/**
 * Ask Qwen a question via Ollama.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function callOllama(prompt) {
  const resp = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      think: false,        // top-level for qwen3 thinking control
      keep_alive: '10m',
      options: { num_predict: 500 }, // bilingual responses need more tokens
    }),
    timeout: 300000, // 5 minutes
  });
  if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
  const data = await resp.json();
  // Strip any <think>...</think> blocks that leak through
  const raw = (data.response || '').trim();
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ─── OLLAMA QUEUE ─────────────────────────────────────────────────────────────

const _ollamaQueue = [];
let _ollamaRunning = false;

/** @returns {number} number of requests waiting + 1 if one is currently running */
function getQueueDepth() {
  return _ollamaQueue.length + (_ollamaRunning ? 1 : 0);
}

async function _drainQueue() {
  if (_ollamaRunning || _ollamaQueue.length === 0) return;
  _ollamaRunning = true;
  const { prompt, resolve, reject } = _ollamaQueue.shift();
  try {
    resolve(await callOllama(prompt));
  } catch (err) {
    reject(err);
  } finally {
    _ollamaRunning = false;
    _drainQueue();
  }
}

/**
 * Queue a prompt for Qwen — runs serially so concurrent requests don't slam Ollama.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
function callOllamaQueued(prompt) {
  return new Promise((resolve, reject) => {
    _ollamaQueue.push({ prompt, resolve, reject });
    _drainQueue();
  });
}

/**
 * Build full context string from cache for Qwen prompt.
 * @returns {Promise<string>}
 */
async function buildFullContext() {
  const { fixtures, teamStats, predictions, results } = await getCache();

  const todaySgt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const todayMatches = fixtures.filter((f) => {
    const d = new Date(f.dateIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    return d === todaySgt;
  });

  // Find opening match (earliest fixture)
  const sorted = [...fixtures].sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso));
  const opener = sorted[0];
  const openerLine = opener
    ? `OPENING MATCH: ${opener.team1} vs ${opener.team2} on ${opener.dateSgt} at ${opener.timeSgt} SGT (Group ${opener.group}, ${opener.venue})`
    : '';

  const recentResults = Object.entries(results).slice(-3).map(([id, r]) => `${id}: ${r.score1}-${r.score2}`).join(', ');
  const predSummary = Object.values(predictions).slice(-5).map((p) => `${p.team1} vs ${p.team2}: ${p.winner} ${p.predicted_score} (${p.confidence}%)`).join(', ');
  const teamList = Object.entries(teamStats).slice(0, 8).map(([t, s]) => `${t} rank#${s.rank} form ${s.form}`).join(', ');

  // Group summary for quick reference
  const groupSummary = 'GROUPS: A(Mexico,S.Africa,S.Korea,Czechia) B(Canada,Switzerland,Qatar,Bosnia) C(Brazil,Morocco,Haiti,Scotland) D(USA,Paraguay,Australia,Turkiye) E(Germany,Curacao,IvoryCoast,Ecuador) F(Netherlands,Japan,Sweden,Tunisia) G(Belgium,Egypt,Iran,NZ) H(Spain,CapeVerde,SaudiArabia,Uruguay) I(France,Senegal,Norway,Iraq) J(Argentina,Algeria,Austria,Jordan) K(Portugal,DRCongo,Uzbekistan,Colombia) L(England,Croatia,Ghana,Panama)';

  return [
    `TOURNAMENT: FIFA World Cup 2026 — hosted by USA, Canada, Mexico`,
    `DATES: June 11–July 19, 2026 | 48 teams | 12 groups | 104 matches`,
    openerLine,
    groupSummary,
    `TODAY (SGT): ${todaySgt}`,
    todayMatches.length ? `TODAY'S MATCHES: ${todayMatches.map((f) => `${f.team1} vs ${f.team2} ${f.timeSgt}`).join(', ')}` : 'NO MATCHES TODAY',
    recentResults ? `RESULTS: ${recentResults}` : 'NO RESULTS YET — tournament has not started',
    `TOP TEAMS: ${teamList}`,
    predSummary ? `PREDICTIONS: ${predSummary}` : '',
  ].filter(Boolean).join('\n');
}

// ─── TELEGRAM FORMATTING ─────────────────────────────────────────────────────

/**
 * Escape Telegram MarkdownV2 special characters.
 * @param {string} text
 * @returns {string}
 */
function escapeMd(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

/**
 * Truncate and clean a qwen response for Telegram (max 4000 chars).
 * Sends as plain text to avoid MarkdownV2 parse errors.
 * @param {string} text
 * @returns {string}
 */
function formatForTelegram(text) {
  if (!text) return 'No response generated.';
  return text.slice(0, 4000);
}

module.exports = {
  getCache,
  refreshCache,
  getChatHistory,
  saveToHistory,
  checkRateLimit,
  callOllama,
  callOllamaQueued,
  getQueueDepth,
  buildFullContext,
  escapeMd,
  formatForTelegram,
};
