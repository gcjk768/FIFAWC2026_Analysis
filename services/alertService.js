'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const TELEGRAM_MCP = 'http://localhost:3003';
const SENT_ALERTS_FILE = path.join(__dirname, '../data/sent-alerts.json');

// ─── MARKDOWN ESCAPING ──────────────────────────────────────────────────────

/**
 * Escape special characters for Telegram MarkdownV2.
 * @param {string} text
 * @returns {string}
 */
function escapeMd(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

// ─── SENT-ALERTS TRACKING ───────────────────────────────────────────────────

/**
 * Read sent-alerts.json safely.
 * @returns {object}
 */
function readSentAlerts() {
  try {
    if (!fs.existsSync(SENT_ALERTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SENT_ALERTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Check if a specific alert has already been sent.
 * @param {string} alertKey - e.g. "3day-a-mexico-vs-south-africa"
 * @returns {boolean}
 */
function isAlertSent(alertKey) {
  return !!readSentAlerts()[alertKey];
}

/**
 * Mark an alert as sent (atomic write).
 * @param {string} alertKey
 */
function markAlertSent(alertKey) {
  const alerts = readSentAlerts();
  alerts[alertKey] = new Date().toISOString();
  const tmp = SENT_ALERTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(alerts, null, 2));
  fs.renameSync(tmp, SENT_ALERTS_FILE);
}

// ─── TELEGRAM SEND ──────────────────────────────────────────────────────────

/**
 * Send a message via the Telegram MCP.
 * @param {string} message
 * @param {string} [parseMode]
 * @returns {Promise<void>}
 */
async function sendToChannel(message, parseMode = 'MarkdownV2') {
  const resp = await fetch(`${TELEGRAM_MCP}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, parse_mode: parseMode }),
  });
  const data = await resp.json();
  if (!data.success) throw new Error(data.error || 'Telegram send failed');
}

// ─── MESSAGE FORMATTERS ─────────────────────────────────────────────────────

/**
 * Build the daily digest message.
 * @param {object} opts
 * @param {string} opts.dateSgt
 * @param {string} opts.countdownText
 * @param {string} opts.calendarSection
 * @param {string} opts.newsSection
 * @param {string} opts.injurySection
 * @param {boolean} opts.tournamentStarted
 * @returns {string}
 */
function buildDailyDigest({ dateSgt, countdownText, calendarSection, newsSection, injurySection, tournamentStarted }) {
  const lines = [
    `⚽ *WC2026 Daily Digest — ${escapeMd(dateSgt)} SGT*`,
    ``,
  ];

  if (!tournamentStarted) {
    lines.push(
      `⏱ *Countdown to Opening Match*`,
      `🏟 Mexico vs South Africa`,
      `📅 12 Jun 2026, 01:00 SGT`,
      `⏰ ${escapeMd(countdownText)} to go`,
      ``,
      `─────────────────────────`,
    );
  }

  lines.push(
    `📅 *Today's Matches \\(SGT\\)*`,
    escapeMd(calendarSection) || `_No matches today_`,
    ``,
    `─────────────────────────`,
    `📰 *Latest Football News*`,
    newsSection || `_News unavailable_`,
    ``,
    `─────────────────────────`,
    `🚑 *Injury Updates*`,
    injurySection || `_No confirmed injuries_`,
    ``,
    `─────────────────────────`,
    `_Powered by qwen3\\.5:35b • ${escapeMd(dateSgt)} SGT_`,
  );

  return lines.join('\n');
}

/**
 * Build the 3-day pre-match preview message.
 * @param {object} fixture
 * @param {object} prediction
 * @param {string} injurySection
 * @param {string} h2hSection
 * @returns {string}
 */
function buildThreeDayPreview(fixture, prediction, injurySection, h2hSection) {
  const { team1, team2, group, dateSgt, timeSgt, venue } = fixture;
  const pred = prediction || {};

  const lines = [
    `🔮 *3\\-DAY MATCH PREVIEW*`,
    ``,
    `⚽ *${escapeMd(team1)} vs ${escapeMd(team2)}*`,
    `📅 ${escapeMd(dateSgt)}, ${escapeMd(timeSgt)} SGT \\| Group ${escapeMd(group)}`,
    `📍 ${escapeMd(venue)}`,
    `⏰ 3 days to go`,
    ``,
    `─────────────────────────`,
    `🏆 *AI Prediction \\(qwen3\\.5:35b\\)*`,
  ];

  if (pred.winner) {
    lines.push(
      `Winner: ${escapeMd(pred.winner)} \\| Score: ${escapeMd(pred.predicted_score || '?-?')}`,
      `Confidence: ${escapeMd(String(pred.confidence || 0))}% \\| Risk: ${escapeMd(pred.risk_factor || 'unknown')}`,
    );
  } else {
    lines.push(`_Analysis not yet run_`);
  }

  if (pred.key_factors?.length) {
    lines.push(``, `─────────────────────────`, `🔑 *Key Factors*`);
    pred.key_factors.slice(0, 3).forEach((f) => lines.push(`• ${escapeMd(f)}`));
  }

  lines.push(
    ``,
    `─────────────────────────`,
    `🚑 *Injury \\& Doubt List*`,
    injurySection ? escapeMd(injurySection) : `_No confirmed injuries_`,
    ``,
    `─────────────────────────`,
    `📊 *Head\\-to\\-Head*`,
    h2hSection ? escapeMd(h2hSection) : `_No H2H data available_`,
    ``,
    `_Analysis by qwen3\\.5:35b via Ollama_`,
  );

  return lines.join('\n');
}

/**
 * Build the 1-day final preview message.
 * @param {object} fixture
 * @param {object} prediction
 * @param {string} weatherSection
 * @param {string} newsSection
 * @param {string} injurySection
 * @returns {string}
 */
function buildOneDayPreview(fixture, prediction, weatherSection, newsSection, injurySection) {
  const { team1, team2, group, dateSgt, timeSgt, venue } = fixture;
  const pred = prediction || {};

  const kickoff = new Date(fixture.dateIso);
  const hoursUntil = Math.round((kickoff - Date.now()) / 3600000);
  const pred1 = TEAM_STATS_STUB[team1] || {};
  const pred2 = TEAM_STATS_STUB[team2] || {};

  const lines = [
    `⚡ *MATCH TOMORROW — FINAL PREVIEW*`,
    ``,
    `⚽ *${escapeMd(team1)} vs ${escapeMd(team2)}*`,
    `📅 ${escapeMd(dateSgt)}, ${escapeMd(timeSgt)} SGT \\| Group ${escapeMd(group)}`,
    `📍 ${escapeMd(venue)}`,
    `⏰ Match in ~${escapeMd(String(hoursUntil))} hours`,
    ``,
    `─────────────────────────`,
    `🏆 *Final Prediction*`,
  ];

  if (pred.winner) {
    lines.push(
      `Winner: *${escapeMd(pred.winner)}*`,
      `Score: *${escapeMd(pred.predicted_score || '?-?')}*`,
      `Confidence: ${escapeMd(String(pred.confidence || 0))}%`,
    );
  } else {
    lines.push(`_No prediction yet_`);
  }

  lines.push(
    ``,
    `─────────────────────────`,
    `🌤 *Match Conditions*`,
    `Venue: ${escapeMd(venue)}`,
    weatherSection ? escapeMd(weatherSection) : `_Weather data unavailable_`,
    ``,
    `─────────────────────────`,
    `📰 *Pre\\-Match News*`,
    newsSection || `_No news available_`,
    ``,
    `─────────────────────────`,
    `🚑 *Late Injury News*`,
    injurySection ? escapeMd(injurySection) : `_No confirmed injuries_`,
    ``,
    `_Match day tomorrow — qwen3\\.5:35b is ready_ ⚽`,
  );

  return lines.join('\n');
}

/**
 * Build the full-time result message.
 * @param {object} fixture
 * @param {object} result
 * @param {object} prediction
 * @returns {string}
 */
function buildResultMessage(fixture, result, prediction) {
  const { team1, team2, group, dateSgt, venue } = fixture;
  const { score1, score2, goalscorers = [], cards = [], stats = {} } = result;
  const pred = prediction || {};

  const actual = `${score1}\\-${score2}`;
  const actualWinner = score1 > score2 ? team1 : score2 > score1 ? team2 : 'draw';
  const predWinner = pred.winner || '?';
  const predScore = escapeMd(pred.predicted_score || '?-?');

  let accuracy = '❌ Wrong prediction';
  if (predWinner === actualWinner) {
    if (pred.predicted_score === `${score1}-${score2}`) {
      accuracy = '✅ Perfect prediction\\!';
    } else {
      accuracy = '🤏 Correct winner, wrong score';
    }
  }

  const lines = [
    `🏁 *FULL TIME*`,
    ``,
    `⚽ *${escapeMd(team1)} ${score1} — ${score2} ${escapeMd(team2)}*`,
    `📅 ${escapeMd(dateSgt)} SGT \\| Group ${escapeMd(group)} \\| ${escapeMd(venue)}`,
    ``,
    `─────────────────────────`,
  ];

  if (goalscorers.length) {
    lines.push(`⚽ *Goals*`);
    goalscorers.forEach((g) => lines.push(`${escapeMd(String(g.minute))}\\'  ${escapeMd(g.player)} \\(${escapeMd(g.team)}\\)`));
    lines.push(``);
  }

  if (cards.length) {
    lines.push(`🟨 *Cards*`);
    cards.forEach((c) => lines.push(`${escapeMd(String(c.minute))}\\'  ${escapeMd(c.player)} \\(${escapeMd(c.team)}\\) — ${escapeMd(c.type)}`));
    lines.push(``);
  }

  if (Object.keys(stats).length) {
    lines.push(
      `─────────────────────────`,
      `📊 *Match Stats*`,
      `\`\`\``,
      `               ${team1.padEnd(12)} ${team2}`,
      `Possession:    ${String(stats.possession1 || '?').padEnd(12)} ${stats.possession2 || '?'}%`,
      `Shots:         ${String(stats.shots1 || '?').padEnd(12)} ${stats.shots2 || '?'}`,
      `On Target:     ${String(stats.onTarget1 || '?').padEnd(12)} ${stats.onTarget2 || '?'}`,
      `\`\`\``,
    );
  }

  lines.push(
    `─────────────────────────`,
    `🎯 *Prediction Accuracy*`,
    `My prediction: ${predScore} \\(${escapeMd(predWinner)}\\)`,
    `Actual result: ${actual} \\(${escapeMd(actualWinner)}\\)`,
    accuracy,
    ``,
    `_Result saved to Obsidian for qwen analysis_ 📓`,
  );

  return lines.join('\n');
}

// Stub — scheduler passes real stats from server
const TEAM_STATS_STUB = {};

module.exports = {
  escapeMd,
  isAlertSent,
  markAlertSent,
  sendToChannel,
  buildDailyDigest,
  buildThreeDayPreview,
  buildOneDayPreview,
  buildResultMessage,
};
