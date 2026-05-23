'use strict';

require('dotenv').config({ override: true });

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const { getCountdown, getOpeningMatchCountdown, getMatchesForDate, getMatchesInNextDays, buildCalendarSection, todaySgt, OPENING_MATCH } = require('./services/countdownService');
const { isAlertSent, markAlertSent, sendToChannel, buildDailyDigest, buildThreeDayPreview, buildOneDayPreview, buildResultMessage } = require('./services/alertService');
const { fetchWC2026News, fetchTeamNews, fetchTopNews, formatNews, writeNewsToObsidian, isNewsSent, markNewsSent } = require('./services/newsService');
const { readResults, writeResult, fetchFullMatchData, fetchWeather, fetchTournamentStats, writeResultToObsidian } = require('./services/resultsService');
const { fetchKnockoutResults, readKnockout } = require('./services/knockoutService');
const { onResultReceived, onKnockoutResultReceived } = require('./services/liveDataService');

const DIGEST_TIME_SGT = process.env.DIGEST_TIME_SGT || '08:00';
const SERVER_URL = `http://localhost:${process.env.PORT || 3001}`;
const OBSIDIAN_MCP = 'http://localhost:3002';

// ─── FIXTURES CACHE ──────────────────────────────────────────────────────────

let FIXTURES = [];

/**
 * Load fixtures from main server API.
 * @returns {Promise<void>}
 */
async function loadFixtures() {
  try {
    const resp = await fetch(`${SERVER_URL}/api/matches`, { timeout: 5000 });
    const data = await resp.json();
    FIXTURES = data;
    console.log(`[SCHEDULER] Fixtures loaded: ${FIXTURES.length} matches`);
  } catch (err) {
    console.error('[SCHEDULER] Could not load fixtures from server:', err.message);
  }
}

// ─── OBSIDIAN HELPERS ─────────────────────────────────────────────────────────

/**
 * Read a note from Obsidian vault.
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function readObsidianNote(filename) {
  try {
    const resp = await fetch(`${OBSIDIAN_MCP}/read?filename=${encodeURIComponent(filename)}`, { timeout: 5000 });
    const data = await resp.json();
    return data.content || '';
  } catch {
    return '';
  }
}

/**
 * Write upcoming fixtures to Obsidian so Qwen always has the schedule.
 * @returns {Promise<void>}
 */
async function writeFixturesToObsidian() {
  if (!FIXTURES.length) return;
  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  const upcoming = FIXTURES
    .filter((f) => new Date(f.dateIso) > Date.now())
    .sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso))
    .slice(0, 30);

  const byDay = {};
  for (const f of upcoming) {
    const day = f.dateSgt;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(f);
  }

  const lines = [
    `# WC2026 Upcoming Fixtures`,
    `<!-- last-updated: ${now} SGT -->`,
    ``,
    `*Qwen: use this file to answer questions about upcoming matches, kickoff times, and venues.*`,
    ``,
  ];

  for (const [day, matches] of Object.entries(byDay)) {
    lines.push(`## ${day} SGT`);
    for (const m of matches) {
      lines.push(`- **${m.timeSgt}** — ${m.team1} vs ${m.team2} | Group ${m.group} | ${m.venue}`);
    }
    lines.push('');
  }

  try {
    await fetch(`${OBSIDIAN_MCP}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'WC2026/upcoming-fixtures.md', content: lines.join('\n') }),
      timeout: 8000,
    });
    console.log('[SCHEDULER] Obsidian upcoming-fixtures.md updated');
  } catch (err) {
    console.error('[SCHEDULER] writeFixturesToObsidian error:', err.message);
  }
}

// ─── PREDICTION HELPERS ───────────────────────────────────────────────────────

/**
 * Get stored prediction for a matchId, triggering analysis if missing.
 * @param {string} matchId
 * @returns {Promise<object|null>}
 */
async function getPrediction(matchId) {
  try {
    const resp = await fetch(`${SERVER_URL}/api/predictions/${matchId}`, { timeout: 5000 });
    if (resp.status === 404) {
      // Trigger analysis
      console.log(`[SCHEDULER] No prediction for ${matchId} — triggering analysis`);
      await fetch(`${SERVER_URL}/api/analyze/${matchId}`, { method: 'POST', timeout: 180000 });
      const r2 = await fetch(`${SERVER_URL}/api/predictions/${matchId}`, { timeout: 5000 });
      if (r2.ok) return r2.json();
    }
    if (resp.ok) return resp.json();
  } catch (err) {
    console.error(`[SCHEDULER] getPrediction error for ${matchId}:`, err.message);
  }
  return null;
}

// ─── JOB 1: DAILY DIGEST ─────────────────────────────────────────────────────

/**
 * Build and send the daily digest.
 */
async function sendDailyDigest() {
  console.log('[SCHEDULER] Sending daily digest...');
  const today = todaySgt();
  const { countdown, match: openingMatch } = getOpeningMatchCountdown();
  const todayMatches = getMatchesForDate(FIXTURES, today);
  const calendarSection = buildCalendarSection(FIXTURES, 7);

  const newsArticles = await fetchWC2026News(3);
  const newsSection = formatNews(newsArticles);

  const injuryNote = await readObsidianNote('WC2026/injuries.md');
  const injurySection = injuryNote
    ? injuryNote.split('\n').filter((l) => l.startsWith('|') || l.startsWith('##')).slice(0, 8).join('\n')
    : '';

  const tournamentStarted = countdown.started;
  const msg = buildDailyDigest({
    dateSgt: today,
    countdownText: countdown.text,
    calendarSection: todayMatches.length
      ? todayMatches.map((m) => `⚽ ${m.timeSgt} — ${m.team1} vs ${m.team2} | Group ${m.group}\n   🏟 ${m.venue}`).join('\n')
      : `No matches today — next: ${getMatchesInNextDays(FIXTURES, 3).slice(0, 1).map((m) => `${m.team1} vs ${m.team2} on ${m.dateSgt}`)[0] || 'TBC'}`,
    newsSection,
    injurySection,
    tournamentStarted,
  });

  try {
    await sendToChannel(msg);
    console.log(`[SCHEDULER] Daily digest sent (${today})`);
  } catch (err) {
    console.error('[SCHEDULER] Daily digest error:', err.message);
  }
}

// ─── JOB 2: 3-DAY PRE-MATCH ALERTS ──────────────────────────────────────────

/**
 * Check and send 3-day previews for any match 3 days away.
 */
async function checkThreeDayAlerts() {
  const threeDaysOut = getMatchesInNextDays(FIXTURES, 4).filter((f) => {
    const daysUntil = (new Date(f.dateIso) - Date.now()) / 86400000;
    return daysUntil >= 2.5 && daysUntil <= 3.5;
  });

  for (const fixture of threeDaysOut) {
    const alertKey = `3day-${fixture.matchId}`;
    if (isAlertSent(alertKey)) continue;

    console.log(`[SCHEDULER] Sending 3-day preview: ${fixture.team1} vs ${fixture.team2}`);
    const prediction = await getPrediction(fixture.matchId);
    const injuryNote = await readObsidianNote('WC2026/injuries.md');
    const h2hNote = await readObsidianNote('WC2026/head-to-head.md');

    const msg = buildThreeDayPreview(fixture, prediction, injuryNote, h2hNote);

    try {
      await sendToChannel(msg);
      markAlertSent(alertKey);
      console.log(`[SCHEDULER] 3-day preview sent: ${fixture.matchId}`);
    } catch (err) {
      console.error(`[SCHEDULER] 3-day preview error: ${err.message}`);
    }
  }
}

// ─── JOB 3: 1-DAY PRE-MATCH ALERTS ──────────────────────────────────────────

/**
 * Check and send 1-day final previews for any match tomorrow.
 */
async function checkOneDayAlerts() {
  const oneDayOut = getMatchesInNextDays(FIXTURES, 2).filter((f) => {
    const daysUntil = (new Date(f.dateIso) - Date.now()) / 86400000;
    return daysUntil >= 0.5 && daysUntil <= 1.5;
  });

  for (const fixture of oneDayOut) {
    const alertKey = `1day-${fixture.matchId}`;
    if (isAlertSent(alertKey)) continue;

    console.log(`[SCHEDULER] Sending 1-day preview: ${fixture.team1} vs ${fixture.team2}`);
    const prediction = await getPrediction(fixture.matchId);

    const cityMatch = (fixture.venue || '').match(/,\s*(.+)$/);
    const city = cityMatch ? cityMatch[1].trim() : 'USA';
    const weather = await fetchWeather(city);
    const newsArticles = await fetchTeamNews(fixture.team1, fixture.team2, 2);
    const newsSection = formatNews(newsArticles);
    const injuryNote = await readObsidianNote('WC2026/injuries.md');

    const msg = buildOneDayPreview(fixture, prediction, weather, newsSection, injuryNote);

    try {
      await sendToChannel(msg);
      markAlertSent(alertKey);
      console.log(`[SCHEDULER] 1-day preview sent: ${fixture.matchId}`);
    } catch (err) {
      console.error(`[SCHEDULER] 1-day preview error: ${err.message}`);
    }
  }
}

// ─── JOB 4: RESULT POLLING ───────────────────────────────────────────────────

/**
 * Check if any match is currently in its result window (kickoff → kickoff + 130min)
 * and poll for the result.
 */
async function checkResults() {
  const now = Date.now();
  const activeMatches = FIXTURES.filter((f) => {
    const kickoff = new Date(f.dateIso).getTime();
    return now >= kickoff && now <= kickoff + 130 * 60000;
  });

  for (const fixture of activeMatches) {
    const alertKey = `result-${fixture.matchId}`;
    if (isAlertSent(alertKey)) continue;

    const result = await fetchFullMatchData(fixture.matchId, fixture.team1, fixture.team2, fixture.dateIso);
    if (!result) continue;

    console.log(`[SCHEDULER] Result found: ${fixture.team1} ${result.score1}-${result.score2} ${fixture.team2}`);

    let prediction = null;
    try {
      const r = await fetch(`${SERVER_URL}/api/predictions/${fixture.matchId}`, { timeout: 5000 });
      if (r.ok) prediction = await r.json();
    } catch {}

    const msg = buildResultMessage(fixture, result, prediction);

    try {
      await sendToChannel(msg);
      markAlertSent(alertKey);
      writeResult(fixture.matchId, result);

      // Write individual match result note to Obsidian
      await writeResultToObsidian(fixture.matchId, fixture, result, prediction);

      // Refresh live standings, team form, and invalidate stale predictions
      const allResults = readResults();
      await onResultReceived(fixture.team1, fixture.team2, FIXTURES, allResults);

      console.log(`[SCHEDULER] Result alert sent: ${fixture.matchId}`);
    } catch (err) {
      console.error(`[SCHEDULER] Result alert error: ${err.message}`);
    }
  }
}

// ─── JOB 1b: MIDNIGHT COUNTDOWN ──────────────────────────────────────────────

/**
 * Send midnight countdown — fires at 00:00 SGT every day.
 * Shows days/hours to opening match + today's fixtures.
 */
async function sendMidnightCountdown() {
  console.log('[SCHEDULER] Sending midnight countdown...');
  const { countdown } = getOpeningMatchCountdown();
  const today = todaySgt();
  const todayMatches = getMatchesForDate(FIXTURES, today);

  const lines = [];

  if (!countdown.started) {
    lines.push(`⏳ *WC2026 Countdown* | 世界杯倒计时`);
    lines.push(``);
    lines.push(`🏆 Opening match | 揭幕战：*Mexico vs South Africa*`);
    lines.push(`📅 12 Jun 2026 at 01:00 SGT`);
    lines.push(``);
    lines.push(`⏰ ${countdown.text} to go | 还有 ${countdown.days} 天 ${countdown.hours} 小时 ${countdown.minutes} 分钟`);
  } else {
    lines.push(`🏆 *FIFA World Cup 2026 is live\\!* | 世界杯正在进行中！`);
    lines.push(``);
    lines.push(`📅 Today | 今天 — ${today} SGT`);
  }

  if (todayMatches.length > 0) {
    lines.push(``);
    lines.push(`⚽ *Today's Matches | 今日赛程*`);
    for (const m of todayMatches) {
      lines.push(`  ${m.timeSgt} — *${m.team1} vs ${m.team2}* | Group ${m.group}`);
      lines.push(`  🏟 ${m.venue}`);
    }
  } else if (countdown.started) {
    const next = getMatchesInNextDays(FIXTURES, 3).slice(0, 1)[0];
    lines.push(``);
    lines.push(`No matches today | 今天没有比赛${next ? ` — next up | 下一场：*${next.team1} vs ${next.team2}* on ${next.dateSgt}` : ''}`);
  }

  const msg = lines.join('\n');
  try {
    await sendToChannel(msg);
    console.log(`[SCHEDULER] Midnight countdown sent (${today})`);
  } catch (err) {
    console.error('[SCHEDULER] Midnight countdown error:', err.message);
  }
}

// ─── JOB 5: NEWS ALERTS ──────────────────────────────────────────────────────

/**
 * Fetch top WC2026 news from FIFA, vet it, post new stories to Telegram,
 * and update Obsidian. Runs every 4 hours.
 */
async function checkNewsUpdates() {
  console.log('[SCHEDULER] Checking for new WC2026 news...');

  const articles = await fetchTopNews(5);  // up to 5 unseen, scored articles

  if (articles.length === 0) {
    console.log('[SCHEDULER] No new news stories to post');
    // Still refresh Obsidian with latest regardless of sent status
    const latest = await fetchTopNews(8, true);  // skipSentCheck for Obsidian
    await writeNewsToObsidian(latest);
    return;
  }

  // Post top 3 new stories to Telegram
  const toPost = articles.slice(0, 3);
  const escapeMd = (t) => String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);

  const lines = [
    `📰 *WC2026 News Update | 世界杯最新消息*`,
    ``,
  ];

  for (const a of toPost) {
    const age = Math.round((Date.now() - new Date(a.publishedAt).getTime()) / 3600000);
    const ageLabel = age < 1 ? 'just now | 刚刚' : `${age}h ago | ${age}小时前`;
    lines.push(`📌 *${escapeMd(a.title)}*`);
    if (a.summary) lines.push(`${escapeMd(a.summary.slice(0, 120))}${a.summary.length > 120 ? '\\.\\.\\.' : ''}`);
    lines.push(`_${escapeMd(a.source)} • ${ageLabel}_`);
    lines.push(``);
  }

  lines.push(`_Source: FIFA\\.com Top Stories | 来源：FIFA官网精选_`);

  try {
    await sendToChannel(lines.join('\n'));
    markNewsSent(toPost.map((a) => a.id));
    console.log(`[SCHEDULER] News alert sent (${toPost.length} stories)`);
  } catch (err) {
    console.error('[SCHEDULER] News alert send error:', err.message);
  }

  // Write all fetched articles (including sent ones) to Obsidian
  const allLatest = await fetchTopNews(8, true);
  await writeNewsToObsidian(allLatest);
}

// ─── CRON SETUP ───────────────────────────────────────────────────────────────

/**
 * Parse DIGEST_TIME_SGT (HH:mm) to cron expression.
 * @param {string} timeStr
 * @returns {string}
 */
function timeToCron(timeStr) {
  const [hh, mm] = (timeStr || '08:00').split(':').map(Number);
  return `${mm || 0} ${hh || 8} * * *`;
}

// ─── STARTUP ─────────────────────────────────────────────────────────────────

async function start() {
  console.log('[SCHEDULER] WC2026 Alert Scheduler starting...');

  // Wait for server to be ready
  await new Promise((r) => setTimeout(r, 3000));
  await loadFixtures();

  const { countdown } = getOpeningMatchCountdown();
  const sentAlerts = Object.keys(require('./services/alertService').isAlertSent ? {} : {});

  console.log(`[SCHEDULER] Opening match: ${OPENING_MATCH.team1} vs ${OPENING_MATCH.team2} — 12 Jun 2026, 01:00 SGT`);
  console.log(`[SCHEDULER] Countdown: ${countdown.text}`);
  console.log(`[SCHEDULER] Jobs scheduled:`);
  console.log(`  - Midnight Countdown:  every day at 00:00 SGT`);
  console.log(`  - Daily Digest:        every day at ${DIGEST_TIME_SGT} SGT`);
  console.log(`  - News Alerts:         every 4 hours (FIFA Top Stories → Telegram + Obsidian)`);
  console.log(`  - 3-Day Alerts:        checking every hour`);
  console.log(`  - 1-Day Alerts:        checking every hour`);
  console.log(`  - Result Polling:      every 5min during match windows`);
  console.log(`  - Knockout Polling:    every 5min from Jun 28 onwards`);

  // Midnight countdown every day at 00:00 SGT
  cron.schedule('0 0 * * *', sendMidnightCountdown, { timezone: 'Asia/Singapore' });

  // Daily digest at DIGEST_TIME_SGT
  cron.schedule(timeToCron(DIGEST_TIME_SGT), sendDailyDigest, { timezone: 'Asia/Singapore' });

  // News check every 4 hours — fetches FIFA top stories, posts new ones to Telegram, updates Obsidian
  cron.schedule('0 */4 * * *', checkNewsUpdates, { timezone: 'Asia/Singapore' });

  // Alert checks every hour
  cron.schedule('0 * * * *', async () => {
    await checkThreeDayAlerts();
    await checkOneDayAlerts();
  }, { timezone: 'Asia/Singapore' });

  // Result polling every 5 minutes
  cron.schedule('*/5 * * * *', checkResults, { timezone: 'Asia/Singapore' });

  // Knockout bracket polling — every 5 minutes from Jun 28 onwards
  cron.schedule('*/5 * * * *', async () => {
    const now = new Date();
    const knockoutStart = new Date('2026-06-28T00:00:00+08:00');
    if (now >= knockoutStart) {
      const updated = await fetchKnockoutResults();
      if (updated) {
        console.log('[SCHEDULER] Knockout bracket updated');
        await onKnockoutResultReceived(readKnockout());
      }
    }
  }, { timezone: 'Asia/Singapore' });

  console.log(`  - Knockout Polling: every 5min from Jun 28 onwards`);

  // Seed Obsidian with latest data on startup
  console.log('[SCHEDULER] Seeding Obsidian vault on startup...');
  await Promise.allSettled([
    writeFixturesToObsidian(),
    checkNewsUpdates(),
  ]);

  // Check immediately on startup for any due alerts
  console.log('[SCHEDULER] Checking for due alerts on startup...');
  await checkThreeDayAlerts();
  await checkOneDayAlerts();
  await checkResults();
  console.log('[SCHEDULER] Startup check complete — scheduler running');
}

start().catch((err) => console.error('[SCHEDULER] Fatal startup error:', err.message));
