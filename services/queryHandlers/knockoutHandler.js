'use strict';

const { readKnockout, formatKnockoutMatch, getCurrentRound } = require('../knockoutService');
const { escapeMd } = require('../chatService');

const ROUND_LABELS = {
  roundOf32:     'Round of 32',
  roundOf16:     'Round of 16',
  quarterFinals: 'Quarter-Finals',
  semiFinals:    'Semi-Finals',
  thirdPlace:    '3rd Place Play-off',
  final:         'Final',
};

const ROUND_DATES = {
  roundOf32:     'Jun 28 – Jul 1',
  roundOf16:     'Jul 3–5',
  quarterFinals: 'Jul 8–9',
  semiFinals:    'Jul 13–14',
  thirdPlace:    'Jul 18',
  final:         'Jul 19',
};

/**
 * Format a set of matches for one round.
 * @param {object[]|object|null} matches
 * @param {string} roundKey
 * @returns {string[]} lines
 */
function formatRoundSection(matches, roundKey) {
  const label = ROUND_LABELS[roundKey] || roundKey;
  const dates = ROUND_DATES[roundKey] ? ` \\(${escapeMd(ROUND_DATES[roundKey])}\\)` : '';
  const lines = [`\n*${escapeMd(label)}*${dates}`];

  if (!matches || (Array.isArray(matches) && matches.length === 0)) {
    lines.push('_Results appear automatically after group stage_');
    return lines;
  }

  const list = Array.isArray(matches) ? matches : [matches];
  for (const m of list) {
    lines.push(formatKnockoutMatch(m));
  }
  return lines;
}

/**
 * Handle /bracket — full knockout bracket display.
 */
async function handleBracket() {
  const { rounds, champion, lastUpdated } = readKnockout();
  const currentRound = getCurrentRound();
  const hasData = rounds.roundOf32.length > 0 || rounds.roundOf16.length > 0;

  const lines = ['🏆 *WC2026 Knockout Bracket*\n'];

  if (champion) {
    lines.push(`🥇 *WORLD CHAMPIONS: ${escapeMd(champion)}* 🥇\n`);
  }

  if (!hasData) {
    lines.push('_Knockout bracket updates automatically once the group stage ends \\(after Jun 28\\)\\._');
    lines.push('_Make sure `FOOTBALL_API_KEY` is set in your \\.env for automatic updates\\._');
    lines.push('');
    lines.push('*Knockout Schedule \\(planned\\):*');
    lines.push(`• Round of 32: ${escapeMd(ROUND_DATES.roundOf32)}`);
    lines.push(`• Round of 16: ${escapeMd(ROUND_DATES.roundOf16)}`);
    lines.push(`• Quarter\\-Finals: ${escapeMd(ROUND_DATES.quarterFinals)}`);
    lines.push(`• Semi\\-Finals: ${escapeMd(ROUND_DATES.semiFinals)}`);
    lines.push(`• 3rd Place: ${escapeMd(ROUND_DATES.thirdPlace)}`);
    lines.push(`• *Final: ${escapeMd(ROUND_DATES.final)}* ⭐`);
  } else {
    // Show each round
    const roundOrder = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];
    for (const key of roundOrder) {
      lines.push(...formatRoundSection(rounds[key], key));
    }

    if (lastUpdated) {
      const updStr = new Date(lastUpdated).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
      lines.push(`\n_Last updated: ${escapeMd(updStr)} SGT_`);
    }
  }

  lines.push('\n\\-\\-\\-');
  lines.push('🇨🇳 *2026世界杯淘汰赛对阵*\n');

  if (!hasData) {
    lines.push('_小组赛结束后（6月28日后）淘汰赛对阵将自动更新。_');
    lines.push('_请确保 .env 中已设置 `FOOTBALL_API_KEY`。_');
    lines.push('');
    lines.push('*淘汰赛赛程（计划）：*');
    lines.push('• 32强赛：6月28日–7月1日');
    lines.push('• 16强赛：7月3–5日');
    lines.push('• 四分之一决赛：7月8–9日');
    lines.push('• 半决赛：7月13–14日');
    lines.push('• 季军赛：7月18日');
    lines.push('• *决赛：7月19日* ⭐');
  } else {
    const zhLabels = {
      roundOf32:     '32强赛',
      roundOf16:     '16强赛',
      quarterFinals: '四分之一决赛',
      semiFinals:    '半决赛',
      thirdPlace:    '季军赛',
      final:         '决赛',
    };
    const roundOrder = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];
    for (const key of roundOrder) {
      const zh = zhLabels[key];
      const matches = rounds[key];
      if (!matches || (Array.isArray(matches) && matches.length === 0)) continue;
      lines.push(`\n*${zh}*`);
      const list = Array.isArray(matches) ? matches : [matches];
      for (const m of list) lines.push(formatKnockoutMatch(m));
    }
  }

  return lines.join('\n');
}

/**
 * Handle queries about a specific round (e.g. "quarter finals", "semi finals").
 * @param {string} text
 */
async function handleRound(text) {
  const t = text.toLowerCase();
  let key = 'roundOf32';
  if (t.match(/semi/)) key = 'semiFinals';
  else if (t.match(/quarter|quart/)) key = 'quarterFinals';
  else if (t.match(/final(?!s)/i) && !t.match(/semi|quarter/)) key = 'final';
  else if (t.match(/16|sixteen|round of 16/)) key = 'roundOf16';
  else if (t.match(/32|thirty.?two|round of 32/)) key = 'roundOf32';
  else if (t.match(/third|3rd|bronze/)) key = 'thirdPlace';

  const { rounds, champion } = readKnockout();
  const matches = rounds[key];
  const label = ROUND_LABELS[key];

  if (!matches || (Array.isArray(matches) && matches.length === 0)) {
    return [
      `📋 *${escapeMd(label)}*`,
      '',
      `_Not yet available — updates automatically via football\\-data\\.org API once matches are scheduled\\._`,
      `_Planned dates: ${escapeMd(ROUND_DATES[key] || 'TBD')}_`,
    ].join('\n');
  }

  if (key === 'final' && champion) {
    return `🥇 *WC2026 CHAMPION: ${escapeMd(champion)}* 🥇\n\n${formatKnockoutMatch(Array.isArray(matches) ? matches[0] : matches)}`;
  }

  const list = Array.isArray(matches) ? matches : [matches];
  const lines = [`📋 *${escapeMd(label)}* \\(${escapeMd(ROUND_DATES[key] || 'TBD')}\\)\n`];
  for (const m of list) lines.push(formatKnockoutMatch(m));
  return lines.join('\n');
}

module.exports = { handleBracket, handleRound };
