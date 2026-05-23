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
    return `📊 *Group ${group} — Teams*\n\n${teamNames}\n\n_Tournament starts 12 Jun 2026 — standings update after each match_`;
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
    return `🥇 *Top Scorers*\n\n_No goals scored yet — tournament starts 12 Jun 2026\\!_`;
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
  return `📊 *WC2026 Group Standings*\n\nUse /group A through /group L to see specific group tables\\.\n\nGroups: A B C D E F G H I J K L\n\n_Tournament starts 12 Jun 2026_`;
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
    return `📈 *WC2026 Tournament Stats*\n\n_Tournament starts 12 Jun 2026 — stats will update after each match\\._`;
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

module.exports = { handleGroupStandings, handleTopScorers, handleAllStandings, handleTournamentStats };
