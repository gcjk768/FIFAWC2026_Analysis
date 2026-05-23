'use strict';

const fetch = require('node-fetch');

const NEWS_API_KEY = process.env.NEWS_API_KEY || '';

/**
 * Fetch latest WC2026 football news.
 * Uses newsapi.org if NEWS_API_KEY is set, otherwise returns placeholder.
 * @param {number} limit
 * @returns {Promise<Array<{ title: string, source: string, url: string }>>}
 */
async function fetchWC2026News(limit = 3) {
  if (!NEWS_API_KEY) {
    console.log('[NEWS] No NEWS_API_KEY — skipping news fetch');
    return [];
  }

  try {
    const url = `https://newsapi.org/v2/everything?q=%22World+Cup+2026%22+football&sortBy=publishedAt&pageSize=${limit}&language=en&apiKey=${NEWS_API_KEY}`;
    const resp = await fetch(url, { timeout: 10000 });
    const data = await resp.json();

    if (data.status !== 'ok') {
      console.error('[NEWS] newsapi.org error:', data.message);
      return [];
    }

    return (data.articles || []).slice(0, limit).map((a) => ({
      title: a.title || '',
      source: a.source?.name || 'Unknown',
      url: a.url || '',
      publishedAt: a.publishedAt || '',
    }));
  } catch (err) {
    console.error('[NEWS] fetchWC2026News error:', err.message);
    return [];
  }
}

/**
 * Fetch news mentioning specific teams.
 * @param {string} team1
 * @param {string} team2
 * @param {number} limit
 * @returns {Promise<Array<{ title: string, source: string, url: string }>>}
 */
async function fetchTeamNews(team1, team2, limit = 2) {
  if (!NEWS_API_KEY) return [];

  try {
    const q = encodeURIComponent(`"${team1}" OR "${team2}" World Cup 2026`);
    const url = `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=${limit}&language=en&apiKey=${NEWS_API_KEY}`;
    const resp = await fetch(url, { timeout: 10000 });
    const data = await resp.json();

    if (data.status !== 'ok') return [];

    return (data.articles || []).slice(0, limit).map((a) => ({
      title: a.title || '',
      source: a.source?.name || 'Unknown',
      url: a.url || '',
    }));
  } catch (err) {
    console.error('[NEWS] fetchTeamNews error:', err.message);
    return [];
  }
}

/**
 * Format news articles for Telegram (plain text, no MarkdownV2 links).
 * @param {Array<{ title: string, source: string }>} articles
 * @returns {string} Formatted string or empty string if no articles
 */
function formatNews(articles) {
  if (!articles || articles.length === 0) return '';
  return articles.map((a) => `• ${a.title} — _${a.source}_`).join('\n');
}

module.exports = { fetchWC2026News, fetchTeamNews, formatNews };
