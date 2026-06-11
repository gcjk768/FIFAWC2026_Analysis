'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { toZh } = require('./countryNames');

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
 * Send a message via the Telegram MCP with retry (up to 2 retries on transient failures).
 * @param {string} message
 * @param {string} [parseMode]
 * @returns {Promise<void>}
 */
async function sendToChannel(message, parseMode = 'MarkdownV2') {
  const MAX_RETRIES = 2;
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${TELEGRAM_MCP}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, parse_mode: parseMode }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Telegram send failed');
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES) break;
      const waitMs = Math.pow(2, attempt) * 1500;
      console.warn(`[ALERT] sendToChannel attempt ${attempt + 1} failed — retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ─── MESSAGE FORMATTERS ─────────────────────────────────────────────────────

/**
 * Build the daily digest message.
 * @param {object} opts
 * @param {string} opts.dateSgt
 * @param {string} opts.countdownText
 * @param {string} opts.calendarSection
 * @param {string} opts.newsSection - pre-escaped MarkdownV2 (from formatNews)
 * @param {string} opts.injurySection
 * @param {boolean} opts.tournamentStarted
 * @returns {string}
 */
function buildDailyDigest({ dateSgt, countdownText, calendarSection, newsSection, injurySection, tournamentStarted }) {
  const lines = [
    `⚽ *WC2026 Daily Digest \\| 每日简报 — ${escapeMd(dateSgt)} SGT*`,
    ``,
  ];

  if (!tournamentStarted) {
    lines.push(
      `⏱ *Countdown to Opening Match \\| 揭幕战倒计时*`,
      `🏟 Mexico vs South Africa`,
      `📅 12 Jun 2026, 03:00 SGT`,
      `⏰ ${escapeMd(countdownText)} to go \\| 还有这么久`,
      ``,
      `─────────────────────────`,
    );
  }

  lines.push(
    `📅 *Today's Matches \\(SGT\\) \\| 今日赛程*`,
    escapeMd(calendarSection) || `_No matches today \\| 今天没有比赛_`,
    ``,
    `─────────────────────────`,
    `📰 *Latest Football News \\| 最新足球新闻*`,
    newsSection || `_News unavailable \\| 暂无新闻_`,
    ``,
    `─────────────────────────`,
    `🚑 *Injury Updates \\| 伤病更新*`,
    injurySection ? escapeMd(injurySection) : `_No confirmed injuries \\| 暂无确认伤情_`,
    ``,
    `─────────────────────────`,
    `_Powered by qwen3\\.6:35b • ${escapeMd(dateSgt)} SGT_`,
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
    `🏆 *AI Prediction \\(qwen3\\.6:35b\\)*`,
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
    `_Analysis by qwen3\\.6:35b via Ollama_`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🇨🇳 *赛前3天预览*`,
    ``,
    `⚽ *${escapeMd(toZh(team1))} vs ${escapeMd(toZh(team2))}*`,
    `📅 ${escapeMd(dateSgt)}, ${escapeMd(timeSgt)} SGT \\| ${escapeMd(group)}组`,
    `📍 ${escapeMd(venue)}`,
    `⏰ 还有3天`,
    ``,
    `─────────────────────────`,
    `🏆 *AI预测 \\(qwen3\\.6:35b\\)*`,
  );

  if (pred.winner) {
    lines.push(
      `预测赢家：${escapeMd(toZh(pred.winner))} \\| 比分：${escapeMd(pred.predicted_score || '?-?')}`,
      `置信度：${escapeMd(String(pred.confidence || 0))}% \\| 风险：${escapeMd(pred.risk_factor || '未知')}`,
    );
  } else {
    lines.push(`_尚未运行分析_`);
  }

  if (pred.key_factors?.length) {
    lines.push(``, `─────────────────────────`, `🔑 *关键因素*`);
    pred.key_factors.slice(0, 3).forEach((f) => lines.push(`• ${escapeMd(f)}`));
  }

  lines.push(
    ``,
    `─────────────────────────`,
    `🚑 *伤病疑问名单*`,
    injurySection ? escapeMd(injurySection) : `_暂无确认伤情_`,
    ``,
    `─────────────────────────`,
    `📊 *历史交锋*`,
    h2hSection ? escapeMd(h2hSection) : `_暂无历史交锋数据_`,
    ``,
    `_qwen3\\.6:35b via Ollama 提供支持_`,
  );

  return lines.join('\n');
}

/**
 * Build the 1-day final preview message.
 * @param {object} fixture
 * @param {object} prediction
 * @param {string} weatherSection
 * @param {string} newsSection - pre-escaped MarkdownV2 (from formatNews)
 * @param {string} injurySection
 * @returns {string}
 */
function buildOneDayPreview(fixture, prediction, weatherSection, newsSection, injurySection) {
  const { team1, team2, group, dateSgt, timeSgt, venue } = fixture;
  const pred = prediction || {};

  const kickoff = fixture.dateIso ? new Date(fixture.dateIso) : new Date();
  const hoursUntil = Math.max(0, Math.round((kickoff - Date.now()) / 3600000));

  const lines = [
    `⚡ *MATCH TOMORROW — FINAL PREVIEW*`,
    ``,
    `⚽ *${escapeMd(team1)} vs ${escapeMd(team2)}*`,
    `📅 ${escapeMd(dateSgt)}, ${escapeMd(timeSgt)} SGT \\| Group ${escapeMd(group)}`,
    `📍 ${escapeMd(venue)}`,
    `⏰ Match in \\~${escapeMd(String(hoursUntil))} hours`,
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
    `_Match day tomorrow — qwen3\\.6:35b is ready_ ⚽`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🇨🇳 *明天比赛 — 最终预测*`,
    ``,
    `⚽ *${escapeMd(toZh(team1))} vs ${escapeMd(toZh(team2))}*`,
    `📅 ${escapeMd(dateSgt)}, ${escapeMd(timeSgt)} SGT \\| ${escapeMd(group)}组`,
    `📍 ${escapeMd(venue)}`,
    `⏰ 约${escapeMd(String(hoursUntil))}小时后开赛`,
    ``,
    `─────────────────────────`,
    `🏆 *最终预测*`,
  );

  if (pred.winner) {
    lines.push(
      `预测赢家：*${escapeMd(toZh(pred.winner))}*`,
      `比分：*${escapeMd(pred.predicted_score || '?-?')}*`,
      `置信度：${escapeMd(String(pred.confidence || 0))}%`,
    );
  } else {
    lines.push(`_尚无预测_`);
  }

  lines.push(
    ``,
    `─────────────────────────`,
    `🌤 *比赛条件*`,
    `场馆：${escapeMd(venue)}`,
    weatherSection ? escapeMd(weatherSection) : `_天气数据不可用_`,
    ``,
    `─────────────────────────`,
    `📰 *赛前新闻*`,
    newsSection || `_暂无新闻_`,
    ``,
    `─────────────────────────`,
    `🚑 *最新伤病消息*`,
    injurySection ? escapeMd(injurySection) : `_暂无确认伤情_`,
    ``,
    `_明天是比赛日 — qwen3\\.6:35b 已就绪_ ⚽`,
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
  const { score1, score2, htScore1, htScore2, goalscorers = [], cards = [], stats = {} } = result;
  const pred = prediction || {};

  const actual = `${score1}:${score2}`;
  const actualWinner = score1 > score2 ? team1 : score2 > score1 ? team2 : 'draw';
  const predWinner = pred.winner || '?';
  const predScore = escapeMd(pred.predicted_score || '?-?');
  const hasHt = htScore1 !== null && htScore2 !== null;
  const hasStats = stats && Object.values(stats).some((v) => v !== null && v !== undefined && v !== 'espn');
  const pad = (v, w = 6) => String(v !== null && v !== undefined ? v : '—').padEnd(w);

  let accuracyEn, accuracyZh;
  if (predWinner === actualWinner) {
    if (pred.predicted_score === `${score1}-${score2}`) {
      accuracyEn = '✅ Perfect prediction\\!';
      accuracyZh = '✅ 完美预测！';
    } else {
      accuracyEn = '🤏 Correct winner, wrong score';
      accuracyZh = '🤏 赢家预测正确，比分有误';
    }
  } else {
    accuracyEn = '❌ Wrong prediction';
    accuracyZh = '❌ 预测错误';
  }

  // ── English section ──
  const en = [
    `🏁 *FULL TIME*`,
    ``,
    `⚽ *${escapeMd(team1)} ${score1}:${score2} ${escapeMd(team2)}*`,
    hasHt ? `🕐 *Half Time:* ${htScore1}:${htScore2}` : '',
    `📅 ${escapeMd(dateSgt)} SGT \\| Group ${escapeMd(group)} \\| ${escapeMd(venue)}`,
    ``,
    `─────────────────────────`,
  ].filter((l) => l !== '');

  if (goalscorers.length) {
    en.push(`⚽ *Goals*`);
    goalscorers.forEach((g) => {
      const tag = g.type === 'PENALTY' ? ' 🎯' : g.type === 'OWN_GOAL' ? ' \\(og\\)' : '';
      en.push(`${escapeMd(String(g.minute))}\\'  ${escapeMd(g.player)} \\(${escapeMd(g.team)}\\)${tag}`);
    });
    en.push(``);
  }

  if (cards.length) {
    en.push(`🟨 *Cards*`);
    cards.forEach((c) => en.push(`${escapeMd(String(c.minute))}\\'  ${escapeMd(c.player)} \\(${escapeMd(c.team)}\\) — ${escapeMd(c.type)}`));
    en.push(``);
  }

  if (hasStats) {
    const t1h = team1.slice(0, 10).padEnd(10);
    const t2h = team2.slice(0, 10);
    en.push(
      `─────────────────────────`,
      `📊 *Match Stats*`,
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

  en.push(
    `─────────────────────────`,
    `🎯 *Prediction Accuracy*`,
    `My prediction: ${predScore} \\(${escapeMd(predWinner)}\\)`,
    `Actual result: ${actual} \\(${escapeMd(actualWinner)}\\)`,
    accuracyEn,
    ``,
    `_Result saved to Obsidian_ 📓`,
  );

  // ── Chinese section ──
  const zh = [
    `🇨🇳 *比赛结束*`,
    ``,
    `⚽ *${escapeMd(toZh(team1))} ${score1}:${score2} ${escapeMd(toZh(team2))}*`,
    hasHt ? `🕐 *半场：* ${htScore1}:${htScore2}` : '',
    `📅 ${escapeMd(dateSgt)} SGT \\| ${escapeMd(group)}组 \\| ${escapeMd(venue)}`,
    ``,
    `─────────────────────────`,
  ].filter((l) => l !== '');

  if (goalscorers.length) {
    zh.push(`⚽ *进球*`);
    goalscorers.forEach((g) => {
      const tag = g.type === 'PENALTY' ? ' 🎯' : g.type === 'OWN_GOAL' ? ' \\(og\\)' : '';
      zh.push(`${escapeMd(String(g.minute))}\\'  ${escapeMd(g.player)} \\(${escapeMd(toZh(g.team))}\\)${tag}`);
    });
    zh.push(``);
  }

  if (cards.length) {
    zh.push(`🟨 *纪律*`);
    cards.forEach((c) => zh.push(`${escapeMd(String(c.minute))}\\'  ${escapeMd(c.player)} \\(${escapeMd(toZh(c.team))}\\) — ${escapeMd(c.type)}`));
    zh.push(``);
  }

  if (hasStats) {
    const t1h = toZh(team1).slice(0, 10).padEnd(10);
    const t2h = toZh(team2).slice(0, 10);
    zh.push(
      `─────────────────────────`,
      `📊 *比赛数据*`,
      `\`\`\``,
      `             ${t1h}  ${t2h}`,
      `控球率   ${pad(stats.possession1)}%   ${stats.possession2 !== null ? stats.possession2 + '%' : '—'}`,
      `射门     ${pad(stats.shots1)}    ${stats.shots2 !== null ? stats.shots2 : '—'}`,
      `射正     ${pad(stats.shotsOnTarget1)}    ${stats.shotsOnTarget2 !== null ? stats.shotsOnTarget2 : '—'}`,
      `传球     ${pad(stats.passes1)}    ${stats.passes2 !== null ? stats.passes2 : '—'}`,
      `传球准确 ${pad(stats.passAccuracy1)}%   ${stats.passAccuracy2 !== null ? stats.passAccuracy2 + '%' : '—'}`,
      `角球     ${pad(stats.corners1)}    ${stats.corners2 !== null ? stats.corners2 : '—'}`,
      `犯规     ${pad(stats.fouls1)}    ${stats.fouls2 !== null ? stats.fouls2 : '—'}`,
      `扑救     ${pad(stats.saves1)}    ${stats.saves2 !== null ? stats.saves2 : '—'}`,
      `\`\`\``,
    );
  }

  zh.push(
    `─────────────────────────`,
    `🎯 *预测准确性*`,
    `我的预测：${predScore} \\(${escapeMd(toZh(predWinner))}\\)`,
    `实际结果：${actual} \\(${escapeMd(toZh(actualWinner))}\\)`,
    accuracyZh,
    ``,
    `_结果已保存至Obsidian_ 📓`,
  );

  return [...en, ``, `━━━━━━━━━━━━━━━━━━━━━━━━━`, ``, ...zh].join('\n');
}

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
