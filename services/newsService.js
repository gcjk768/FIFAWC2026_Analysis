'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { escapeMd } = require('./alertService');

const NEWS_API_KEY    = process.env.NEWS_API_KEY || '';
const SENT_NEWS_FILE  = path.join(__dirname, '../data/sent-news.json');
const OBSIDIAN_MCP    = 'http://localhost:3002';

// FIFA CMS "Top stories" section — editorially curated by FIFA, no key needed
const FIFA_NEWS_URL = 'https://cxm-api.fifa.com/fifaplusweb/api/sections/news/1aQDyhkYnKhkAW347zYi4Y?locale=en&limit=20';
const FIFA_BASE_URL = 'https://www.fifa.com';

// WC2026 relevance keywords for scoring articles
const WC2026_KEYWORDS = [
  'world cup', '2026', 'wc2026', 'canada', 'mexico', 'usa', 'group stage',
  'qualifier', 'squad', 'injury', 'lineup', 'preview', 'final', 'knockout',
];

// Trusted source tiers for newsapi.org results (FIFA feed is always tier 1)
const SOURCE_TIER = {
  'BBC Sport': 3, 'ESPN': 3, 'The Guardian': 3, 'Sky Sports': 3,
  'Goal': 2, 'FourFourTwo': 2, 'The Athletic': 3, 'Reuters': 3,
  'AP News': 3, 'Marca': 2, 'L\'Equipe': 2,
};

// ─── SENT-NEWS TRACKING ───────────────────────────────────────────────────────

/**
 * Read sent-news.json safely.
 * @returns {object}
 */
function readSentNews() {
  try {
    if (!fs.existsSync(SENT_NEWS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SENT_NEWS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Check if a news article has already been sent.
 * @param {string} articleId - slug or URL used as dedup key
 * @returns {boolean}
 */
function isNewsSent(articleId) {
  return !!readSentNews()[articleId];
}

/**
 * Mark one or more articles as sent (atomic write).
 * @param {string[]} articleIds
 */
function markNewsSent(articleIds) {
  const sent = readSentNews();
  const now = new Date().toISOString();
  for (const id of articleIds) sent[id] = now;

  // Prune entries older than 7 days to keep the file small
  const cutoff = Date.now() - 7 * 86400000;
  for (const [id, ts] of Object.entries(sent)) {
    if (new Date(ts).getTime() < cutoff) delete sent[id];
  }

  const tmp = SENT_NEWS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(sent, null, 2));
  fs.renameSync(tmp, SENT_NEWS_FILE);
}

// ─── FIFA NEWS (NO KEY REQUIRED) ─────────────────────────────────────────────

/**
 * Fetch WC2026 top stories from FIFA's official website.
 * Uses the same CMS API the FIFA website uses — no key required.
 * Articles are already editorially curated as "Top stories" by FIFA.
 * @param {number} limit
 * @returns {Promise<Array<{ title, source, url, summary, publishedAt, id }>>}
 */
async function fetchFifaNews(limit = 10) {
  try {
    const resp = await fetch(FIFA_NEWS_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!resp.ok) {
      console.warn(`[NEWS] FIFA news HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json();

    return (data.items || []).slice(0, limit).map((a) => ({
      id:          a.slug || a.entryId || a.title,
      title:       a.title || '',
      summary:     a.previewText || '',
      source:      'FIFA.com',
      url:         a.articlePageUrl
        ? (a.articlePageUrl.startsWith('http') ? a.articlePageUrl : `${FIFA_BASE_URL}${a.articlePageUrl}`)
        : `${FIFA_BASE_URL}/en/news`,
      publishedAt: a.publishedDate || new Date().toISOString(),
      tags:        (a.tags || []).concat((a.semanticTags || []).map((t) => t.title || '')),
      roofline:    a.roofline || '',
    }));
  } catch (err) {
    console.error('[NEWS] fetchFifaNews error:', err.message);
    return [];
  }
}

// ─── NEWSAPI.ORG (REQUIRES API KEY) ──────────────────────────────────────────

/**
 * Fetch WC2026 news from newsapi.org (requires NEWS_API_KEY).
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function fetchNewsApiArticles(limit = 10) {
  if (!NEWS_API_KEY) return [];
  try {
    const url = `https://newsapi.org/v2/everything?q=%22World+Cup+2026%22+football&sortBy=publishedAt&pageSize=${limit}&language=en&apiKey=${NEWS_API_KEY}`;
    const resp = await fetch(url, { timeout: 10000 });
    const data = await resp.json();
    if (data.status !== 'ok') return [];

    return (data.articles || []).slice(0, limit).map((a) => ({
      id:          a.url,
      title:       a.title || '',
      summary:     a.description || '',
      source:      a.source?.name || 'Unknown',
      url:         a.url || '',
      publishedAt: a.publishedAt || new Date().toISOString(),
      tags:        [],
      roofline:    '',
    }));
  } catch (err) {
    console.error('[NEWS] fetchNewsApiArticles error:', err.message);
    return [];
  }
}

// ─── NEWS SCORING & VETTING ───────────────────────────────────────────────────

/**
 * Score an article for relevance and recency.
 * Higher = more worthy of posting.
 * @param {object} article
 * @returns {number}
 */
function scoreArticle(article) {
  let score = 0;

  // Recency: decay score by age (max 100 for brand-new, 0 at 48h)
  const ageHours = (Date.now() - new Date(article.publishedAt).getTime()) / 3600000;
  score += Math.max(0, 100 - ageHours * 2);

  // Source tier bonus
  score += (SOURCE_TIER[article.source] || 1) * 10;

  // FIFA.com is always authoritative
  if (article.source === 'FIFA.com') score += 30;

  // WC2026 keyword relevance in title + summary
  const text = `${article.title} ${article.summary} ${article.tags?.join(' ')}`.toLowerCase();
  for (const kw of WC2026_KEYWORDS) {
    if (text.includes(kw)) score += 5;
  }

  return score;
}

/**
 * Fetch, vet, and return the top N new WC2026 news articles.
 * Tries FIFA first (no key), falls back to newsapi.org.
 * Filters out already-sent articles and articles older than 48 hours.
 * @param {number} limit - max articles to return
 * @param {boolean} skipSentCheck - if true, return top articles regardless of sent status
 * @returns {Promise<Array>}
 */
async function fetchTopNews(limit = 3, skipSentCheck = false) {
  // Fetch from both sources in parallel
  const [fifaArticles, newsApiArticles] = await Promise.all([
    fetchFifaNews(15),
    fetchNewsApiArticles(10),
  ]);

  // Merge, deduplicate by title similarity, score, sort
  const all = [...fifaArticles, ...newsApiArticles];
  const seen = new Set();
  const deduped = all.filter((a) => {
    const key = a.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Filter to last 48 hours only
  const recent = deduped.filter((a) => {
    const ageHours = (Date.now() - new Date(a.publishedAt).getTime()) / 3600000;
    return ageHours <= 48;
  });

  // Filter out already-sent (unless override)
  const unsent = skipSentCheck ? recent : recent.filter((a) => !isNewsSent(a.id));

  // Sort by score descending
  unsent.sort((a, b) => scoreArticle(b) - scoreArticle(a));

  return unsent.slice(0, limit);
}

// ─── LEGACY EXPORTS (kept for backward compatibility with scheduler/alertService) ─

/**
 * Fetch latest WC2026 news — tries FIFA first, then newsapi.org.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function fetchWC2026News(limit = 3) {
  return fetchTopNews(limit, true);  // skipSentCheck=true for digest use
}

/**
 * Fetch news mentioning specific teams (newsapi.org only, needs key).
 * @param {string} team1
 * @param {string} team2
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function fetchTeamNews(team1, team2, limit = 2) {
  if (!NEWS_API_KEY) {
    // Fallback: filter FIFA news for team mentions
    const all = await fetchFifaNews(20);
    return all
      .filter((a) => {
        const text = `${a.title} ${a.summary} ${a.tags?.join(' ')}`.toLowerCase();
        return text.includes(team1.toLowerCase()) || text.includes(team2.toLowerCase());
      })
      .slice(0, limit);
  }

  try {
    const q = encodeURIComponent(`"${team1}" OR "${team2}" World Cup 2026`);
    const url = `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=${limit}&language=en&apiKey=${NEWS_API_KEY}`;
    const resp = await fetch(url, { timeout: 10000 });
    const data = await resp.json();
    if (data.status !== 'ok') return [];

    return (data.articles || []).slice(0, limit).map((a) => ({
      id:          a.url,
      title:       a.title || '',
      summary:     a.description || '',
      source:      a.source?.name || 'Unknown',
      url:         a.url || '',
      publishedAt: a.publishedAt || '',
      tags:        [],
    }));
  } catch (err) {
    console.error('[NEWS] fetchTeamNews error:', err.message);
    return [];
  }
}

/**
 * Format news articles for Telegram (MarkdownV2).
 * Title and source are escaped per-field so the `_italics_` markup survives.
 * @param {Array} articles
 * @returns {string} pre-escaped MarkdownV2 — do not escape again downstream
 */
function formatNews(articles) {
  if (!articles || articles.length === 0) return '';
  return articles.map((a) => `• ${escapeMd(a.title)} — _${escapeMd(a.source)}_`).join('\n');
}

// ─── OBSIDIAN WRITE ───────────────────────────────────────────────────────────

/**
 * Write latest news to Obsidian vault (WC2026/news.md).
 * @param {Array} articles
 * @returns {Promise<void>}
 */
async function writeNewsToObsidian(articles) {
  if (!articles || articles.length === 0) return;

  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  const lines = [
    `# WC2026 Latest News`,
    `<!-- last-updated: ${now} SGT -->`,
    ``,
    `*Qwen: use this file to answer questions about current WC2026 news and developments.*`,
    `*Updated automatically every 4 hours with top FIFA-curated and major outlet stories.*`,
    ``,
  ];

  for (const a of articles) {
    const age = Math.round((Date.now() - new Date(a.publishedAt).getTime()) / 3600000);
    const ageLabel = age < 1 ? 'just now' : age === 1 ? '1 hour ago' : `${age} hours ago`;
    lines.push(`## ${a.title}`);
    lines.push(`- **Source:** ${a.source} | **Published:** ${ageLabel}`);
    if (a.summary) lines.push(`- **Summary:** ${a.summary}`);
    lines.push(`- **URL:** ${a.url}`);
    if (a.roofline) lines.push(`- **Category:** ${a.roofline}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`_Auto-updated by WC2026 Predictor — ${now} SGT_`);

  try {
    await fetch(`${OBSIDIAN_MCP}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'WC2026/news.md', content: lines.join('\n') }),
      timeout: 8000,
    });
    console.log(`[NEWS] Obsidian news.md updated (${articles.length} articles)`);
  } catch (err) {
    console.error('[NEWS] writeNewsToObsidian error:', err.message);
  }
}

module.exports = {
  fetchFifaNews,
  fetchTopNews,
  fetchWC2026News,
  fetchTeamNews,
  formatNews,
  writeNewsToObsidian,
  isNewsSent,
  markNewsSent,
};
