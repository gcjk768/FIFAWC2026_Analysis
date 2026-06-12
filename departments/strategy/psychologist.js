'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  STRATEGY DEPT — MATCH PSYCHOLOGIST                         ║
 * ║  Role: Motivation, pressure, and mental edge analysis       ║
 * ║  ✅ CODE-ONLY — Computed from standings maths, no Qwen      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Covers:
 *  - What each team mathematically needs from the match
 *  - Rotation risk (teams already through may rest players)
 *  - Home crowd advantage at host-nation venues
 *  - Revenge narratives from previous tournament encounters
 */

const fetch = require('node-fetch');

const OBSIDIAN_MCP = 'http://localhost:3002';

const HOME_VENUES = {
  'USA':    ['metlife', 'at&t', 'sofi', "levi's", 'allegiant', 'state farm', 'arrowhead', 'empower', 'nrg', 'hard rock', 'lincoln', 'gillette'],
  'Canada': ['bc place', 'bmo'],
  'Mexico': ['azteca', 'akron'],
};

function hasVenueAdvantage(team, venue) {
  const v = (venue || '').toLowerCase();
  return (HOME_VENUES[team] || []).some((kw) => v.includes(kw));
}

async function fetchGroupStandings(group) {
  try {
    const resp = await fetch(
      `${OBSIDIAN_MCP}/read/${encodeURIComponent('WC2026/live-standings.md')}`,
      { timeout: 4000 }
    );
    const data = await resp.json();
    if (!data.content) return {};

    const lines    = data.content.split('\n');
    const standings = {};
    let inGroup    = false;

    for (const line of lines) {
      if (line.match(new RegExp(`(^#{1,2}\\s+Group\\s+${group}\\b)`, 'i'))) { inGroup = true; continue; }
      if (inGroup && line.match(/^#{1,2}\s+Group\s+[A-L]/i) && !line.match(new RegExp(`Group\\s+${group}\\b`, 'i'))) break;

      if (inGroup) {
        const m = line.match(/\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|[^|]*\|[^|]*\|\s*([+-]?\d+)\s*\|\s*(\d+)\s*\|/);
        if (m) {
          standings[m[1].trim()] = {
            played: parseInt(m[2]),
            won:    parseInt(m[3]),
            drawn:  parseInt(m[4]),
            lost:   parseInt(m[5]),
            gd:     parseInt(m[6]),
            points: parseInt(m[7]),
          };
        }
      }
    }
    return standings;
  } catch {
    return {};
  }
}

function computeMotivation(standing, matchday) {
  if (!standing) return 'unknown';
  const { points, played } = standing;

  if (matchday === 1) return 'must-win';

  if (matchday === 2) {
    if (points >= 3) return 'draw-ok';
    if (points === 1) return 'must-win';
    if (points === 0) return 'must-win';
  }

  if (matchday === 3) {
    if (points >= 6) return 'already-qualified';
    if (points >= 4) return 'draw-ok';
    if (points === 3) return 'must-win';
    if (points === 1) return 'must-win';
    if (points === 0) return played >= 2 ? 'already-eliminated' : 'must-win';
  }

  return 'must-win';
}

function computeRotationRisk(standing, matchday) {
  if (!standing || matchday < 3) return false;
  return standing.points >= 6;
}

const REVENGE_PAIRS = [
  { teams: ['France', 'Senegal'],        note: 'Senegal beat defending champion France 1-0 at WC2002 — France seek revenge 24 years later' },
  { teams: ['England', 'Croatia'],       note: "Croatia beat England 2-1 AET in 2018 WC SF — England's defining modern heartbreak" },
  { teams: ['Brazil', 'Morocco'],        note: "Morocco eliminated Brazil on penalties at WC2022 QF — Brazil's biggest recent humiliation" },
  { teams: ['Portugal', 'Morocco'],      note: "Morocco knocked Portugal out 1-0 at WC2022 QF — Ronaldo's tears are unforgettable" },
  { teams: ['Spain', 'Morocco'],         note: 'Morocco beat Spain on penalties at WC2022 — Spain seek revenge in this group' },
  { teams: ['Portugal', 'Uruguay'],      note: 'Uruguay beat Portugal 2-1 at WC2018 R16 — Cavani brace sent Ronaldo home' },
  { teams: ['Germany', 'Japan'],         note: "Japan's 2-1 upset of Germany at WC2022 was one of the biggest shocks in recent WC history" },
  { teams: ['Spain', 'Japan'],           note: 'Japan beat Spain 2-1 at WC2022 group stage — second giant-killing in same tournament' },
  { teams: ['Argentina', 'France'],      note: 'WC2022 Final — Argentina beat France 4-2 on pens after 3-3 AET; Mbappe hat-trick in vain' },
  { teams: ['Netherlands', 'Argentina'], note: 'Netherlands vs Argentina is always dramatic — 2022 WC QF went to pens after 2-2 AET' },
];

function checkRevengeNarrative(team1, team2) {
  for (const pair of REVENGE_PAIRS) {
    if (pair.teams.includes(team1) && pair.teams.includes(team2)) {
      return { hasRevenge: true, note: pair.note };
    }
  }
  return { hasRevenge: false, note: '' };
}

/**
 * Run the Match Psychologist — fully code-based, reads standings from vault.
 * @param {string} team1
 * @param {string} team2
 * @param {string} group
 * @param {number} matchday - 1, 2, or 3
 * @param {string} venue
 * @param {object} s1 - enriched stats
 * @param {object} s2 - enriched stats
 * @returns {Promise<object>}
 */
async function runPsychologistAgent(team1, team2, group, matchday, venue, s1, s2) {
  const standings = await fetchGroupStandings(group);

  const st1 = standings[team1] || (s1.tournamentPlayed > 0 ? {
    points: (s1.tournamentForm.split('').filter((r) => r === 'W').length * 3) +
            (s1.tournamentForm.split('').filter((r) => r === 'D').length),
    played: s1.tournamentPlayed,
  } : null);
  const st2 = standings[team2] || (s2.tournamentPlayed > 0 ? {
    points: (s2.tournamentForm.split('').filter((r) => r === 'W').length * 3) +
            (s2.tournamentForm.split('').filter((r) => r === 'D').length),
    played: s2.tournamentPlayed,
  } : null);

  const team1Motivation   = computeMotivation(st1, matchday);
  const team2Motivation   = computeMotivation(st2, matchday);
  const team1RotationRisk = computeRotationRisk(st1, matchday);
  const team2RotationRisk = computeRotationRisk(st2, matchday);

  const team1Home     = hasVenueAdvantage(team1, venue);
  const team2Home     = hasVenueAdvantage(team2, venue);
  const crowdAdvantage = team1Home ? team1 : team2Home ? team2 : 'neutral';

  const { hasRevenge, note: revengeNote } = checkRevengeNarrative(team1, team2);

  const pressureEdge =
    team1Motivation === 'must-win' && team2Motivation !== 'must-win' ? team1 :
    team2Motivation === 'must-win' && team1Motivation !== 'must-win' ? team2 : 'equal';

  const psychologicalEdge =
    team1Motivation === 'already-qualified' && team2Motivation === 'must-win' ? team1 :
    team2Motivation === 'already-qualified' && team1Motivation === 'must-win' ? team2 :
    team1RotationRisk ? team2 :
    team2RotationRisk ? team1 :
    team1Home && !team2Home ? team1 :
    team2Home && !team1Home ? team2 :
    'neutral';

  const psychFactors = [];
  if (team1RotationRisk) psychFactors.push(`${team1} likely rotating — already through`);
  if (team2RotationRisk) psychFactors.push(`${team2} likely rotating — already through`);
  if (team1Home) psychFactors.push(`${team1} has home crowd at ${venue}`);
  if (team2Home) psychFactors.push(`${team2} has home crowd at ${venue}`);
  if (hasRevenge) psychFactors.push(`REVENGE: ${revengeNote}`);
  if (team1Motivation === 'must-win') psychFactors.push(`${team1} must win — expect high intensity`);
  if (team2Motivation === 'must-win') psychFactors.push(`${team2} must win — expect high intensity`);

  const result = {
    team1Motivation,
    team2Motivation,
    team1RotationRisk,
    team2RotationRisk,
    pressureEdge,
    crowdAdvantage,
    hasRevengeNarrative: hasRevenge,
    revengeNote:         hasRevenge ? revengeNote : null,
    psychologicalEdge,
    psychFactors,
    standingsUsed: { team1: st1, team2: st2 },
    _source:       'code',
  };

  console.log(`[STRATEGY:PSYCH] ${team1} vs ${team2} — motivation: ${team1Motivation} vs ${team2Motivation} | revenge: ${hasRevenge} | crowd: ${crowdAdvantage}`);
  return result;
}

/**
 * Format psychologist report as text block for Chief Strategist prompt.
 * @param {object} report
 * @param {string} team1
 * @param {string} team2
 * @returns {string}
 */
function formatPsychReport(report, team1, team2) {
  const edge = report.psychologicalEdge === 'neutral' ? 'neutral'
    : report.psychologicalEdge === team1 ? team1
    : report.psychologicalEdge === team2 ? team2
    : report.psychologicalEdge;

  const lines = [
    `🧠 PSYCHOLOGICAL & MOTIVATION ANALYSIS (computed from standings):`,
    `${team1} motivation: ${report.team1Motivation}${report.team1RotationRisk ? ' ⚠️ ROTATION RISK — likely resting key players' : ''}`,
    `${team2} motivation: ${report.team2Motivation}${report.team2RotationRisk ? ' ⚠️ ROTATION RISK — likely resting key players' : ''}`,
    `Pressure edge: ${report.pressureEdge === team1 ? team1 : report.pressureEdge === team2 ? team2 : 'equal'}`,
    `Crowd advantage: ${report.crowdAdvantage}`,
    `Psychological edge: ${edge}`,
  ];

  if (report.psychFactors.length > 0) {
    lines.push(`Key factors:`);
    report.psychFactors.forEach((f) => lines.push(`  • ${f}`));
  }

  return lines.join('\n');
}

module.exports = { runPsychologistAgent, formatPsychReport };
