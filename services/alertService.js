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
    `⚽ *WC2026 Daily Digest | 每日简报 — ${escapeMd(dateSgt)} SGT*`,
    ``,
  ];

  if (!tournamentStarted) {
    lines.push(
      `⏱ *Countdown to Opening Match | 揭幕战倒计时*`,
      `🏟 Mexico vs South Africa`,
      `📅 12 Jun 2026, 01:00 SGT`,
      `⏰ ${escapeMd(countdownText)} to go | 还有这么久`,
      ``,
      `─────────────────────────`,
    );
  }

  lines.push(
    `📅 *Today's Matches \\(SGT\\) | 今日赛程*`,
    escapeMd(calendarSection) || `_No matches today | 今天没有比赛_`,
    ``,
    `─────────────────────────`,
    `📰 *Latest Football News | 最新足球新闻*`,
    newsSection || `_News unavailable | 暂无新闻_`,
    ``,
    `─────────────────────────`,
    `🚑 *Injury Updates | 伤病更新*`,
    injurySection || `_No confirmed injuries | 暂无确认伤情_`,
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
    `🔮 *3\\-DAY MATCH PREVIEW | 赛前3天预览*`,
    ``,
    `⚽ *${escapeMd(team1)} vs ${escapeMd(team2)}*`,
    `📅 ${escapeMd(dateSgt)}, ${escapeMd(timeSgt)} SGT \\| Group ${escapeMd(group)}`,
    `📍 ${escapeMd(venue)}`,
    `⏰ 3 days to go | 还有3天`,
    ``,
    `─────────────────────────`,
    `🏆 *AI Prediction | AI预测 \\(qwen3\\.5:35b\\)*`,
  ];

  if (pred.winner) {
    lines.push(
      `Winner | 预测赢家: ${escapeMd(pred.winner)} \\| Score | 比分: ${escapeMd(pred.predicted_score || '?-?')}`,
      `Confidence | 置信度: ${escapeMd(String(pred.confidence || 0))}% \\| Risk | 风险: ${escapeMd(pred.risk_factor || 'unknown')}`,
    );
  } else {
    lines.push(`_Analysis not yet run | 尚未运行分析_`);
  }

  if (pred.key_factors?.length) {
    lines.push(``, `─────────────────────────`, `🔑 *Key Factors | 关键因素*`);
    pred.key_factors.slice(0, 3).forEach((f) => lines.push(`• ${escapeMd(f)}`));
  }

  lines.push(
    ``,
    `─────────────────────────`,
    `🚑 *Injury \\& Doubt List | 伤病疑问名单*`,
    injurySection ? escapeMd(injurySection) : `_No confirmed injuries | 暂无确认伤情_`,
    ``,
    `─────────────────────────`,
    `📊 *Head\\-to\\-Head | 历史交锋*`,
    h2hSection ? escapeMd(h2hSection) : `_No H2H data available | 暂无历史交锋数据_`,
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
    `⚡ *MATCH TOMORROW | 明天比赛 — FINAL PREVIEW | 最终预测*`,
    ``,
    `⚽ *${escapeMd(team1)} vs ${escapeMd(team2)}*`,
    `📅 ${escapeMd(dateSgt)}, ${escapeMd(timeSgt)} SGT \\| Group ${escapeMd(group)}`,
    `📍 ${escapeMd(venue)}`,
    `⏰ Match in ~${escapeMd(String(hoursUntil))} hours | 约${escapeMd(String(hoursUntil))}小时后开赛`,
    ``,
    `─────────────────────────`,
    `🏆 *Final Prediction | 最终预测*`,
  ];

  if (pred.winner) {
    lines.push(
      `Winner | 预测赢家: *${escapeMd(pred.winner)}*`,
      `Score | 比分: *${escapeMd(pred.predicted_score || '?-?')}*`,
      `Confidence | 置信度: ${escapeMd(String(pred.confidence || 0))}%`,
    );
  } else {
    lines.push(`_No prediction yet | 尚无预测_`);
  }

  lines.push(
    ``,
    `─────────────────────────`,
    `🌤 *Match Conditions | 比赛条件*`,
    `Venue | 场馆: ${escapeMd(venue)}`,
    weatherSection ? escapeMd(weatherSection) : `_Weather data unavailable | 天气数据不可用_`,
    ``,
    `─────────────────────────`,
    `📰 *Pre\\-Match News | 赛前新闻*`,
    newsSection || `_No news available | 暂无新闻_`,
    ``,
    `─────────────────────────`,
    `🚑 *Late Injury News | 最新伤病消息*`,
    injurySection ? escapeMd(injurySection) : `_No confirmed injuries | 暂无确认伤情_`,
    ``,
    `_Match day tomorrow | 明天是比赛日 — qwen3\\.5:35b is ready_ ⚽`,
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
  const { score1, score2, htScore1, htScore2, goalscorers = [], cards = [], substitutions = [], stats = {} } = result;
  const pred = prediction || {};

  const actual = `${score1}\\-${score2}`;
  const actualWinner = score1 > score2 ? team1 : score2 > score1 ? team2 : 'draw';
  const predWinner = pred.winner || '?';
  const predScore = escapeMd(pred.predicted_score || '?-?');

  let accuracy = '❌ Wrong prediction | 预测错误';
  if (predWinner === actualWinner) {
    accuracy = pred.predicted_score === `${score1}-${score2}`
      ? '✅ Perfect prediction\\! | 完美预测！'
      : '🤏 Correct winner, wrong score | 赢家预测正确，比分有误';
  }

  const htLine = htScore1 !== null && htScore2 !== null
    ? `\n🕐 *Half Time | 半场:* ${htScore1} — ${htScore2}`
    : '';

  const lines = [
    `🏁 *FULL TIME | 比赛结束*`,
    ``,
    `⚽ *${escapeMd(team1)} ${score1} — ${score2} ${escapeMd(team2)}*`,
    htLine,
    `📅 ${escapeMd(dateSgt)} SGT \\| Group ${escapeMd(group)} \\| ${escapeMd(venue)}`,
    ``,
    `─────────────────────────`,
  ].filter((l) => l !== '');

  if (goalscorers.length) {
    lines.push(`⚽ *Goals | 进球*`);
    goalscorers.forEach((g) => {
      const tag = g.type === 'PENALTY' ? ' 🎯' : g.type === 'OWN_GOAL' ? ' \\(og\\)' : '';
      lines.push(`${escapeMd(String(g.minute))}\\'  ${escapeMd(g.player)} \\(${escapeMd(g.team)}\\)${tag}`);
    });
    lines.push(``);
  }

  if (cards.length) {
    lines.push(`🟨 *Cards | 纪律*`);
    cards.forEach((c) => lines.push(`${escapeMd(String(c.minute))}\\'  ${escapeMd(c.player)} \\(${escapeMd(c.team)}\\) — ${escapeMd(c.type)}`));
    lines.push(``);
  }

  const hasStats = stats && Object.values(stats).some((v) => v !== null && v !== undefined && v !== 'espn');
  if (hasStats) {
    const pad = (v, w = 6) => String(v !== null && v !== undefined ? v : '—').padEnd(w);
    const t1h = team1.slice(0, 10).padEnd(10);
    const t2h = team2.slice(0, 10);
    lines.push(
      `─────────────────────────`,
      `📊 *Match Stats | 比赛数据*`,
      `\`\`\``,
      `             ${t1h}  ${t2h}`,
      `Possession   ${pad(stats.possession1)}%   ${stats.possession2 !== null ? stats.possession2 + '%' : '—'}`,
      `Shots        ${pad(stats.shots1)}    ${stats.shots2 !== null ? stats.shots2 : '—'}`,
      `On Target    ${pad(stats.shotsOnTarget1)}    ${stats.shotsOnTarget2 !== null ? stats.shotsOnTarget2 : '—'}`,
      `Passes       ${pad(stats.passes1)}    ${stats.passes2 !== null ? stats.passes2 : '—'}`,
      `Pass Acc     ${pad(stats.passAccuracy1)}%   ${stats.passAccuracy2 !== null ? stats.passAccuracy2 + '%' : '—'}`,
      `Corners      ${pad(stats.corners1)}    ${stats.corners2 !== null ? stats.corners2 : '—'}`,
      `Fouls        ${pad(stats.fouls1)}    ${stats.fouls2 !== null ? stats.fouls2 : '—'}`,
      `Saves        ${pad(stats.saves1)}    ${stats.saves2 !== null ? stats.saves2 : '—'}`,
      `\`\`\``,
    );
  }

  lines.push(
    `─────────────────────────`,
    `🎯 *Prediction Accuracy | 预测准确性*`,
    `My prediction | 我的预测: ${predScore} \\(${escapeMd(predWinner)}\\)`,
    `Actual result | 实际结果: ${actual} \\(${escapeMd(actualWinner)}\\)`,
    accuracy,
    ``,
    `_Result saved to Obsidian | 结果已保存至Obsidian_ 📓`,
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
