'use strict';

const OPENING_MATCH = {
  dateIso: process.env.OPENING_MATCH_DATE || '2026-06-12T03:00:00+08:00',
  team1: 'Mexico',
  team2: 'South Africa',
  group: 'A',
  venue: 'SoFi Stadium, Los Angeles',
};

/**
 * Returns a human-readable countdown object from now to a target date.
 * @param {string|Date} targetDateIso
 * @returns {{ days: number, hours: number, minutes: number, seconds: number, text: string, started: boolean }}
 */
function getCountdown(targetDateIso) {
  const target = new Date(targetDateIso);
  const diff = target - Date.now();

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, text: 'The tournament has started!', started: true };
  }

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  let text;
  if (days > 0) {
    text = `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else if (hours > 0) {
    text = `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    text = `${minutes} minute${minutes !== 1 ? 's' : ''}, ${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  return { days, hours, minutes, seconds, text, started: false };
}

/**
 * Returns the opening match countdown info.
 * @returns {{ countdown: object, match: object }}
 */
function getOpeningMatchCountdown() {
  return {
    countdown: getCountdown(OPENING_MATCH.dateIso),
    match: OPENING_MATCH,
  };
}

/**
 * Returns all matches on a given SGT date string (YYYY-MM-DD).
 * @param {object[]} fixtures - All fixtures from server
 * @param {string} dateSgt - e.g. "2026-06-12"
 * @returns {object[]}
 */
function getMatchesForDate(fixtures, dateSgt) {
  return fixtures.filter((f) => {
    const d = new Date(f.dateIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    return d === dateSgt;
  });
}

/**
 * Returns the next N upcoming matches from now.
 * @param {object[]} fixtures
 * @param {number} n
 * @returns {object[]}
 */
function getUpcomingMatches(fixtures, n = 5) {
  const now = Date.now();
  return fixtures
    .filter((f) => new Date(f.dateIso) > now)
    .sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso))
    .slice(0, n);
}

/**
 * Returns all matches within the next X days.
 * @param {object[]} fixtures
 * @param {number} days
 * @returns {object[]}
 */
function getMatchesInNextDays(fixtures, days) {
  const now = Date.now();
  const cutoff = now + days * 86400000;
  return fixtures
    .filter((f) => {
      const t = new Date(f.dateIso).getTime();
      return t > now && t <= cutoff;
    })
    .sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso));
}

/**
 * Build a formatted calendar section string for the next daysAhead days.
 * @param {object[]} fixtures
 * @param {number} daysAhead
 * @returns {string}
 */
function buildCalendarSection(fixtures, daysAhead = 7) {
  const upcoming = getMatchesInNextDays(fixtures, daysAhead);
  if (upcoming.length === 0) return 'No upcoming matches in the next week.';

  const byDay = {};
  for (const f of upcoming) {
    const day = new Date(f.dateIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(f);
  }

  const lines = [];
  for (const [day, matches] of Object.entries(byDay)) {
    const label = new Date(day).toLocaleDateString('en-SG', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Singapore',
    });
    lines.push(`📅 ${label}`);
    for (const m of matches) {
      lines.push(`  ⚽ ${m.timeSgt} — ${m.team1} vs ${m.team2} | Group ${m.group}`);
    }
  }

  return lines.join('\n');
}

/**
 * Returns today's SGT date string (YYYY-MM-DD).
 * @returns {string}
 */
function todaySgt() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

module.exports = {
  getCountdown,
  getOpeningMatchCountdown,
  getMatchesForDate,
  getUpcomingMatches,
  getMatchesInNextDays,
  buildCalendarSection,
  todaySgt,
  OPENING_MATCH,
};
