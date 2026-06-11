'use strict';

/**
 * Regression test for Telegram MarkdownV2 escaping (code 400:
 * "Character '.' is reserved and must be escaped").
 * Run: node tests/test-md-escape.js
 */

const { formatNews } = require('../services/newsService');
const { buildDailyDigest, buildOneDayPreview } = require('../services/alertService');

let failures = 0;

/**
 * Assert a condition, log result.
 * @param {string} name
 * @param {boolean} cond
 * @param {string} [detail]
 */
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── formatNews must escape reserved MarkdownV2 chars in title/source ────────
const news = formatNews([
  { title: 'U.S. beat Wales 2-0! (friendly)', source: 'ESPN.com' },
]);
console.log('formatNews:');
check('escapes "." in title', news.includes('U\\.S\\.'));
check('escapes "-" and "!" in title', news.includes('2\\-0\\!'));
check('escapes "(" and ")" in title', news.includes('\\(friendly\\)'));
check('escapes "." in source, keeps italics', news.includes('_ESPN\\.com_'));

// ── buildOneDayPreview must produce a fully-escaped message ─────────────────
const fixture = {
  team1: 'Mexico',
  team2: 'South Africa',
  group: 'A',
  dateSgt: '12 Jun 2026',
  timeSgt: '03:00',
  venue: 'Estadio Azteca, Mexico City',
  dateIso: new Date(Date.now() + 24 * 3600000).toISOString(),
};
const oneDay = buildOneDayPreview(fixture, null, '', news, '');
console.log('buildOneDayPreview:');
check('escapes literal "~" in hours line', oneDay.includes('Match in \\~'));
check('news section stays escaped', oneDay.includes('U\\.S\\.'));
check('does not double-escape news', !oneDay.includes('U\\\\.'));

// ── buildDailyDigest must escape injury table lines from Obsidian ───────────
const digest = buildDailyDigest({
  dateSgt: '11 Jun 2026',
  countdownText: '1 day 2 hours',
  calendarSection: '',
  newsSection: news,
  injurySection: '## Injuries\n| Player | Status |',
  tournamentStarted: false,
});
console.log('buildDailyDigest:');
check('escapes "#" in injury section', digest.includes('\\#\\# Injuries'));
check('escapes "|" in injury table', digest.includes('\\| Player \\| Status \\|'));
check('news section stays escaped', digest.includes('U\\.S\\.'));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
