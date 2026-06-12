'use strict';

const { getCache, escapeMd } = require('../chatService');

/**
 * Get today's SGT date string.
 * @returns {string}
 */
function todaySgt() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/**
 * Format a list of fixtures into a Telegram-ready string.
 * @param {object[]} matches
 * @param {string} label
 * @returns {string}
 */
function formatMatchList(matches, label) {
  if (matches.length === 0) return `No matches ${label}.`;

  const lines = [`📅 *Matches ${escapeMd(label)} — SGT*`, ``];
  for (const m of matches) {
    lines.push(`⚽ *${m.timeSgt} SGT* — ${escapeMd(m.team1)} vs ${escapeMd(m.team2)}`);
    lines.push(`   📍 Group ${m.group} \\| ${escapeMd(m.venue)}`);
    if (m.prediction) {
      lines.push(`   🔮 ${escapeMd(m.prediction.winner)} ${escapeMd(m.prediction.predicted_score)} \\(${m.prediction.confidence}%\\)`);
    }
    lines.push('');
  }
  lines.push(`_All times Singapore Time \\(SGT, UTC\\+8\\)_`);
  return lines.join('\n');
}

/**
 * Handle today's matches query.
 */
async function handleToday() {
  const { fixtures } = await getCache();
  const today = todaySgt();
  const matches = fixtures.filter((f) => {
    const d = new Date(f.dateIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    return d === today;
  });
  return formatMatchList(matches, `Today \\(${escapeMd(today)}\\)`);
}

/**
 * Handle tomorrow's matches query.
 */
async function handleTomorrow() {
  const { fixtures } = await getCache();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const matches = fixtures.filter((f) => {
    const d = new Date(f.dateIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    return d === tomorrowStr;
  });
  return formatMatchList(matches, `Tomorrow \\(${escapeMd(tomorrowStr)}\\)`);
}

/**
 * Handle match time query for specific teams.
 * @param {string} text - raw user query
 */
async function handleMatchTime(text) {
  const { fixtures } = await getCache();
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);

  const found = fixtures.find((f) => {
    const t1 = f.team1.toLowerCase();
    const t2 = f.team2.toLowerCase();
    return words.some((w) => w.length > 3 && (t1.includes(w) || t2.includes(w)));
  });

  if (!found) return `❓ Couldn't find that match\\. Try: "what time is Brazil vs Morocco?"`;

  return [
    `⚽ *${escapeMd(found.team1)} vs ${escapeMd(found.team2)}*`,
    `📅 ${escapeMd(found.dateSgt)} SGT`,
    `🕐 Kickoff: *${escapeMd(found.timeSgt)} SGT*`,
    `📍 Group ${found.group} \\| ${escapeMd(found.venue)}`,
    ``,
    found.prediction
      ? `🔮 Prediction: ${escapeMd(found.prediction.winner)} ${escapeMd(found.prediction.predicted_score)} \\(${found.prediction.confidence}%\\)`
      : `_No prediction yet — ask /predict ${escapeMd(found.team1)} ${escapeMd(found.team2)}_`,
  ].join('\n');
}

/**
 * Handle opening match / Day 1 query — returns all fixtures on the first match day.
 */
async function handleOpeningDay() {
  const { fixtures } = await getCache();
  if (fixtures.length === 0) return '❓ No fixture data available.';

  // Find the earliest date in fixtures
  const sorted = [...fixtures].sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso));
  const firstDateSgt = new Date(sorted[0].dateIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

  // All matches on that first date
  const day1 = sorted.filter((f) => {
    const d = new Date(f.dateIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    return d === firstDateSgt;
  });

  const lines = [
    `⚽ *WC2026 Opening Day — ${escapeMd(firstDateSgt)} SGT*`,
    ``,
    `🏆 *Opening Match:*`,
    `⭐ *${escapeMd(day1[0].timeSgt)} SGT* — *${escapeMd(day1[0].team1)} vs ${escapeMd(day1[0].team2)}*`,
    `   📍 Group ${day1[0].group} \\| ${escapeMd(day1[0].venue)}`,
    ``,
  ];

  if (day1.length > 1) {
    lines.push(`🗓 *Also on Day 1:*`);
    for (const m of day1.slice(1)) {
      lines.push(`⚽ *${escapeMd(m.timeSgt)} SGT* — ${escapeMd(m.team1)} vs ${escapeMd(m.team2)}`);
      lines.push(`   📍 Group ${m.group} \\| ${escapeMd(m.venue)}`);
    }
    lines.push('');
  }

  lines.push(`_All times Singapore Time \\(SGT, UTC\\+8\\)_`);
  lines.push('');
  lines.push('\\-\\-\\-');
  lines.push(`🇨🇳 *2026世界杯开幕日 — ${escapeMd(firstDateSgt)} 新加坡时间*`);
  lines.push('');
  lines.push(`🏆 *开幕战：*`);
  lines.push(`⭐ *${escapeMd(day1[0].timeSgt)} SGT* — *${escapeMd(day1[0].team1)} vs ${escapeMd(day1[0].team2)}*`);
  lines.push(`   📍 ${day1[0].group}组 \\| ${escapeMd(day1[0].venue)}`);

  if (day1.length > 1) {
    lines.push('');
    lines.push(`🗓 *第一天其他比赛：*`);
    for (const m of day1.slice(1)) {
      lines.push(`⚽ *${escapeMd(m.timeSgt)} SGT* — ${escapeMd(m.team1)} vs ${escapeMd(m.team2)}`);
    }
  }

  lines.push('');
  lines.push(`_所有时间均为新加坡时间 \\(SGT, UTC\\+8\\)_`);

  return lines.join('\n');
}

/**
 * Handle schedule query (next N matches).
 * @param {number} n
 */
async function handleSchedule(n = 8) {
  const { fixtures } = await getCache();
  const now = Date.now();
  const upcoming = fixtures
    .filter((f) => new Date(f.dateIso) > now)
    .sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso))
    .slice(0, n);
  return formatMatchList(upcoming, 'Upcoming');
}

/**
 * Handle result query for a team.
 * @param {string} text
 */
async function handleResult(text) {
  const { fixtures, results } = await getCache();
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);

  const played = fixtures.filter((f) => results[f.matchId]);
  const found = played.find((f) => {
    const t1 = f.team1.toLowerCase();
    const t2 = f.team2.toLowerCase();
    return words.some((w) => w.length > 3 && (t1.includes(w) || t2.includes(w)));
  });

  if (!found) {
    if (played.length === 0) return `🏁 No results yet \\— matches may still be in progress\\.`;
    return `❓ No result found for that team yet\\.`;
  }

  const r = results[found.matchId];
  return [
    `🏁 *RESULT*`,
    ``,
    `⚽ *${escapeMd(found.team1)} ${r.score1}:${r.score2} ${escapeMd(found.team2)}*`,
    `📅 ${escapeMd(found.dateSgt)} SGT \\| Group ${found.group}`,
  ].join('\n');
}

module.exports = { handleToday, handleTomorrow, handleMatchTime, handleSchedule, handleResult, handleOpeningDay };
