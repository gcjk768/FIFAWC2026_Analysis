'use strict';

const { getCache, escapeMd } = require('../chatService');

/**
 * Handle group standings query.
 * @param {string} text
 */
async function handleGroupStandings(text) {
  const match = text.match(/\b([a-lA-L])\b/);
  const group = match ? match[1].toUpperCase() : null;

  if (!group) {
    return `❓ Specify a group: /group A  through /group L\n\nGroups: A B C D E F G H I J K L`;
  }

  const { fixtures, results } = await getCache();
  const groupFixtures = fixtures.filter((f) => f.group === group);
  if (groupFixtures.length === 0) return `❓ Group ${group} not found\\.`;

  // Build standings from results
  const teams = {};
  const allTeams = new Set();
  groupFixtures.forEach((f) => { allTeams.add(f.team1); allTeams.add(f.team2); });
  allTeams.forEach((t) => { teams[t] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; });

  for (const f of groupFixtures) {
    const r = results[f.matchId];
    if (!r) continue;
    const { score1, score2 } = r;
    teams[f.team1].p++;
    teams[f.team2].p++;
    teams[f.team1].gf += score1;
    teams[f.team1].ga += score2;
    teams[f.team2].gf += score2;
    teams[f.team2].ga += score1;
    if (score1 > score2) { teams[f.team1].w++; teams[f.team1].pts += 3; teams[f.team2].l++; }
    else if (score1 < score2) { teams[f.team2].w++; teams[f.team2].pts += 3; teams[f.team1].l++; }
    else { teams[f.team1].d++; teams[f.team2].d++; teams[f.team1].pts++; teams[f.team2].pts++; }
  }

  const sorted = Object.entries(teams).sort((a, b) => {
    const pa = a[1], pb = b[1];
    if (pb.pts !== pa.pts) return pb.pts - pa.pts;
    return (pb.gf - pb.ga) - (pa.gf - pa.ga);
  });

  const played = sorted.some(([, s]) => s.p > 0);
  if (!played) {
    const teamNames = [...allTeams].map((t) => `• ${escapeMd(t)}`).join('\n');
    return `📊 *Group ${group} — Teams*\n\n${teamNames}\n\n_No matches played yet in this group \\— standings update after each result_`;
  }

  const lines = [`📊 *Group ${group} Standings*\n`];
  lines.push(`\`Pos  Team              P  W  D  L  GD  Pts\``);
  sorted.forEach(([team, s], i) => {
    const gd = s.gf - s.ga;
    const row = `${String(i + 1).padEnd(4)} ${team.padEnd(18)} ${s.p}  ${s.w}  ${s.d}  ${s.l}  ${String(gd >= 0 ? '+' + gd : gd).padStart(3)}  ${s.pts}`;
    lines.push(`\`${row}\``);
  });

  return lines.join('\n');
}

/**
 * Handle top scorers query.
 */
async function handleTopScorers() {
  const { results, fixtures } = await getCache();
  const scorers = {};

  for (const [matchId, r] of Object.entries(results)) {
    for (const g of (r.goalscorers || [])) {
      const key = `${g.player} (${g.team})`;
      scorers[key] = (scorers[key] || 0) + 1;
    }
  }

  const sorted = Object.entries(scorers).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (sorted.length === 0) {
    return `🥇 *Top Scorers*\n\n_No goals recorded yet \\— check back after results are saved_`;
  }

  const lines = [`🥇 *WC2026 Top Scorers*\n`];
  sorted.forEach(([name, goals], i) => {
    lines.push(`${i + 1}\\. ${escapeMd(name)} — *${goals}* goal${goals !== 1 ? 's' : ''}`);
  });
  return lines.join('\n');
}

/**
 * Handle all standings query.
 */
async function handleAllStandings() {
  return `📊 *WC2026 Group Standings*\n\nUse /group A through /group L to see specific group tables\\.\n\nGroups: A B C D E F G H I J K L`;
}

// Short display names for the group table to keep columns tight
const SHORT_NAME = {
  'Bosnia and Herzegovina': 'Bosnia & Herz.',
  'South Africa':           'South Africa',
  'South Korea':            'South Korea',
  'Ivory Coast':            'Ivory Coast',
  'Saudi Arabia':           'Saudi Arabia',
  'Cape Verde':             'Cape Verde',
  'New Zealand':            'New Zealand',
  'DR Congo':               'DR Congo',
  'Turkiye':                'Türkiye',
};

/**
 * Handle full group draw — all 12 groups as a formatted table.
 */
async function handleAllGroups() {
  const { fixtures } = await getCache();

  const groups = {};
  for (const f of fixtures) {
    if (!groups[f.group]) groups[f.group] = new Set();
    groups[f.group].add(f.team1);
    groups[f.group].add(f.team2);
  }

  const letters = Object.keys(groups).sort();
  if (letters.length === 0) return '❓ No group data available.';

  // Build code-block table (inside ``` no MarkdownV2 escaping needed)
  const rows = letters.map((letter) => {
    const teams = [...groups[letter]].map((t) => SHORT_NAME[t] || t);
    return `  ${letter}  │ ${teams.join(' · ')}`;
  });

  const header = ' Grp │ Teams';
  const divider = '─────┼' + '─'.repeat(55);
  const tableLines = [header, divider, ...rows].join('\n');

  // Chinese group names for bilingual section
  const zhRows = letters.map((letter) => {
    const teams = [...groups[letter]].map((t) => SHORT_NAME[t] || t);
    return `  ${letter}组 │ ${teams.join(' · ')}`;
  });
  const zhTable = [' 组别 │ 球队', '──────┼' + '─'.repeat(55), ...zhRows].join('\n');

  return [
    '🏆 *WC2026 — Full Group Draw \\(12 Groups, 48 Teams\\)*',
    '',
    '```',
    tableLines,
    '```',
    '',
    '_Draw held 5 Dec 2025 in Washington D\\.C\\._',
    '_/group A–L for standings • /predict Team1 Team2_',
    '',
    '\\-\\-\\-',
    '🇨🇳 *2026世界杯 — 完整分组抽签结果*',
    '',
    '```',
    zhTable,
    '```',
    '',
    '_2025年12月5日华盛顿特区完成抽签_',
    '_/group A–L 查看积分榜 · /predict 预测比赛_',
  ].join('\n');
}

/**
 * Handle tournament stats summary.
 */
async function handleTournamentStats() {
  const { results } = await getCache();
  const entries = Object.values(results);
  const played = entries.length;
  const goals = entries.reduce((s, r) => s + (r.score1 || 0) + (r.score2 || 0), 0);
  const avg = played > 0 ? (goals / played).toFixed(2) : '—';

  if (played === 0) {
    return `📈 *WC2026 Tournament Stats*\n\n_No results saved yet \\— stats will update after each match\\._`;
  }

  return [
    `📈 *WC2026 Tournament Stats*`,
    ``,
    `Matches played: *${played}* / 104`,
    `Total goals: *${goals}*`,
    `Avg goals/game: *${avg}*`,
    ``,
    `_Use /topscorers for the Golden Boot race_`,
  ].join('\n');
}

module.exports = { handleGroupStandings, handleTopScorers, handleAllStandings, handleTournamentStats, handleAllGroups };
