'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const OBSIDIAN_MCP = 'http://localhost:3002';
const PREDICTIONS_FILE = path.join(__dirname, '../data/predictions.json');

// ─── OBSIDIAN HELPERS ─────────────────────────────────────────────────────────

/**
 * Write a note to Obsidian vault via MCP (atomic on MCP side).
 * @param {string} filename  - relative to vault root, e.g. 'WC2026/live-standings.md'
 * @param {string} content
 */
async function writeNote(filename, content) {
  try {
    await fetch(`${OBSIDIAN_MCP}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content }),
      timeout: 8000,
    });
    console.log(`[LIVE] Obsidian updated: ${filename}`);
  } catch (err) {
    console.error(`[LIVE] Obsidian write error (${filename}):`, err.message);
  }
}

// ─── STANDINGS COMPUTATION ────────────────────────────────────────────────────

/**
 * Compute current group standings from fixtures and stored results.
 * @param {object[]} fixtures
 * @param {object} results  - { matchId: { score1, score2 } }
 * @returns {object}  { A: { teams: [{ name, p, w, d, l, gf, ga, gd, pts }] } }
 */
function computeStandings(fixtures, results) {
  const groups = {};

  for (const f of fixtures) {
    if (!groups[f.group]) groups[f.group] = {};
    for (const t of [f.team1, f.team2]) {
      if (!groups[f.group][t]) {
        groups[f.group][t] = { name: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
      }
    }

    const r = results[f.matchId];
    if (!r) continue;

    const { score1, score2 } = r;
    const t1 = groups[f.group][f.team1];
    const t2 = groups[f.group][f.team2];

    t1.p++; t2.p++;
    t1.gf += score1; t1.ga += score2;
    t2.gf += score2; t2.ga += score1;

    if (score1 > score2) {
      t1.w++; t1.pts += 3; t2.l++;
    } else if (score2 > score1) {
      t2.w++; t2.pts += 3; t1.l++;
    } else {
      t1.d++; t2.d++; t1.pts++; t2.pts++;
    }
  }

  // Sort each group
  const sorted = {};
  for (const [letter, teams] of Object.entries(groups)) {
    sorted[letter] = Object.values(teams).sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      const gdDiff = (b.gf - b.ga) - (a.gf - a.ga);
      if (gdDiff !== 0) return gdDiff;
      return b.gf - a.gf;
    });
  }
  return sorted;
}

/**
 * Compute per-team tournament form from fixtures and results.
 * Includes stat averages (possession, shots, passes) where ESPN data is available.
 * @param {object[]} fixtures
 * @param {object} results
 * @returns {object}
 */
function computeTournamentForm(fixtures, results) {
  const form = {};

  for (const f of fixtures) {
    const r = results[f.matchId];
    if (!r) continue;

    const { score1, score2, stats = {} } = r;
    const result1 = score1 > score2 ? 'W' : score1 < score2 ? 'L' : 'D';
    const result2 = score1 < score2 ? 'W' : score1 > score2 ? 'L' : 'D';

    const pairs = [
      { team: f.team1, score, conceded: score2, res: result1, isHome: true },
      { team: f.team2, score: score2, conceded: score1, res: result2, isHome: false },
    ];

    for (const { team, score, conceded, res, isHome } of pairs) {
      if (!form[team]) form[team] = { matches: [], gf: 0, ga: 0, group: f.group, statsSum: {}, statsCount: 0 };

      // Accumulate ESPN stats (team1 = home, team2 = away side of stored stats)
      const teamStats = {};
      if (stats.possession1 !== undefined) {
        const possession = isHome ? stats.possession1 : stats.possession2;
        const shots      = isHome ? stats.shots1      : stats.shots2;
        const onTarget   = isHome ? stats.shotsOnTarget1 : stats.shotsOnTarget2;
        const passes     = isHome ? stats.passes1     : stats.passes2;
        const passAcc    = isHome ? stats.passAccuracy1 : stats.passAccuracy2;
        const corners    = isHome ? stats.corners1    : stats.corners2;
        const fouls      = isHome ? stats.fouls1      : stats.fouls2;

        teamStats.possession = possession ? parseFloat(possession) : null;
        teamStats.shots      = shots      ? parseFloat(shots)      : null;
        teamStats.onTarget   = onTarget   ? parseFloat(onTarget)   : null;
        teamStats.passes     = passes     ? parseFloat(passes)     : null;
        teamStats.passAcc    = passAcc    ? parseFloat(passAcc)    : null;
        teamStats.corners    = corners    ? parseFloat(corners)    : null;
        teamStats.fouls      = fouls      ? parseFloat(fouls)      : null;

        if (teamStats.possession !== null) {
          form[team].statsCount++;
          for (const [k, v] of Object.entries(teamStats)) {
            if (v !== null) form[team].statsSum[k] = (form[team].statsSum[k] || 0) + v;
          }
        }
      }

      form[team].matches.push({
        opponent: isHome ? f.team2 : f.team1,
        score:    `${score}-${conceded}`,
        result:   res,
        date:     f.dateSgt,
        stats:    teamStats,
      });
      form[team].gf += score;
      form[team].ga += conceded;
    }
  }

  return form;
}

// ─── OBSIDIAN WRITE JOBS ──────────────────────────────────────────────────────

/**
 * Write live group standings to Obsidian.
 * @param {object[]} fixtures
 * @param {object} results
 */
async function writeStandingsToObsidian(fixtures, results) {
  const standings = computeStandings(fixtures, results);
  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  const totalPlayed = Object.keys(results).length;

  const lines = [
    `# WC2026 Live Group Standings`,
    `<!-- last-updated: ${now} SGT | matches played: ${totalPlayed}/72 -->`,
    ``,
    `*Standings update automatically after every result.*`,
    `*Qwen: use this file to answer live standings questions.*`,
    ``,
  ];

  for (const [letter, teams] of Object.entries(standings).sort()) {
    lines.push(`## Group ${letter}`);
    lines.push(`| Pos | Team | P | W | D | L | GF | GA | GD | Pts |`);
    lines.push(`|-----|------|---|---|---|---|----|----|----|----|`);
    teams.forEach((t, i) => {
      const gd = t.gf - t.ga;
      const gdStr = gd >= 0 ? `+${gd}` : `${gd}`;
      const qual = i < 2 ? '✅' : (i === 2 ? '⚠️' : '❌');
      lines.push(`| ${qual} ${i + 1} | ${t.name} | ${t.p} | ${t.w} | ${t.d} | ${t.l} | ${t.gf} | ${t.ga} | ${gdStr} | **${t.pts}** |`);
    });
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`✅ = qualified position | ⚠️ = possible best 3rd | ❌ = eliminated track`);
  lines.push(`*Top 2 from each group + 8 best 3rd-place teams advance to Round of 32.*`);

  await writeNote('WC2026/live-standings.md', lines.join('\n'));
}

/**
 * Write per-team tournament form tracker to Obsidian.
 * @param {object[]} fixtures
 * @param {object} results
 */
async function writeTournamentFormToObsidian(fixtures, results) {
  const form = computeTournamentForm(fixtures, results);
  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });

  const lines = [
    `# WC2026 Tournament Form Tracker`,
    `<!-- last-updated: ${now} SGT -->`,
    ``,
    `*Qwen: use this file for in-tournament performance context when analyzing upcoming matches.*`,
    `*This reflects ACTUAL performance in WC2026, not pre-tournament stats.*`,
    ``,
  ];

  const sorted = Object.entries(form).sort((a, b) => {
    const aGd = a[1].gf - a[1].ga;
    const bGd = b[1].gf - b[1].ga;
    return bGd - aGd;
  });

  for (const [team, data] of sorted) {
    const results_str = data.matches.map((m) => `${m.result}`).join('');
    const gd = data.gf - data.ga;
    lines.push(`## ${team} (Group ${data.group})`);
    lines.push(`- **Tournament form:** ${results_str || 'No matches yet'}`);
    lines.push(`- **Goals scored:** ${data.gf} | **Goals conceded:** ${data.ga} | **GD:** ${gd >= 0 ? '+' : ''}${gd}`);

    // Stat averages (from ESPN data where available)
    const n = data.statsCount || 0;
    if (n > 0) {
      const avg = (key) => data.statsSum[key] != null ? (data.statsSum[key] / n).toFixed(1) : '—';
      lines.push(`- **Avg stats per game (${n} match${n > 1 ? 'es' : ''}):** Possession ${avg('possession')}% | Shots ${avg('shots')} (on target ${avg('onTarget')}) | Passes ${avg('passes')} (${avg('passAcc')}% acc) | Corners ${avg('corners')} | Fouls ${avg('fouls')}`);
    }

    for (const m of data.matches) {
      const icon = m.result === 'W' ? '✅' : m.result === 'D' ? '🟡' : '❌';
      const statNote = m.stats?.possession != null
        ? ` — ${m.stats.possession}% poss | ${m.stats.shots || '—'} shots | ${m.stats.passes || '—'} passes`
        : '';
      lines.push(`- ${icon} vs ${m.opponent}: **${m.score}** (${m.date})${statNote}`);
    }

    // Find next match
    const remaining = fixtures.filter((f) => {
      const involves = f.team1 === team || f.team2 === team;
      const notPlayed = !results[f.matchId];
      return involves && notPlayed;
    }).sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso));

    if (remaining.length > 0) {
      const next = remaining[0];
      const opp = next.team1 === team ? next.team2 : next.team1;
      lines.push(`- **Next match:** vs ${opp} — ${next.dateSgt} ${next.timeSgt} SGT (Group ${next.group})`);
    } else {
      lines.push(`- **Group stage complete**`);
    }
    lines.push(``);
  }

  await writeNote('WC2026/tournament-form.md', lines.join('\n'));
}

/**
 * Write knockout bracket results to Obsidian.
 * @param {object} knockoutData  - from knockout.json
 */
async function writeKnockoutToObsidian(knockoutData) {
  const { rounds, champion, lastUpdated } = knockoutData;
  const now = lastUpdated
    ? new Date(lastUpdated).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })
    : new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });

  const roundLabels = {
    roundOf32: 'Round of 32', roundOf16: 'Round of 16',
    quarterFinals: 'Quarter-Finals', semiFinals: 'Semi-Finals',
    thirdPlace: '3rd Place Play-off', final: 'Final',
  };
  const roundDates = {
    roundOf32: 'Jun 28 – Jul 1', roundOf16: 'Jul 3–5',
    quarterFinals: 'Jul 8–9', semiFinals: 'Jul 13–14',
    thirdPlace: 'Jul 18', final: 'Jul 19',
  };

  const lines = [
    `# WC2026 Knockout Stage`,
    `<!-- last-updated: ${now} SGT -->`,
    ``,
    `*Qwen: use this file to answer questions about the knockout bracket, who advanced, and upcoming matches.*`,
    ``,
  ];

  if (champion) {
    lines.push(`## 🥇 WORLD CHAMPION: ${champion}`);
    lines.push(``);
  }

  for (const key of ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final']) {
    const matches = rounds[key];
    const label = roundLabels[key];
    const dates = roundDates[key];
    lines.push(`## ${label} (${dates})`);

    if (!matches || (Array.isArray(matches) && matches.length === 0)) {
      lines.push(`*Matches TBD*`);
    } else {
      const list = Array.isArray(matches) ? matches : [matches];
      for (const m of list) {
        if (m.status === 'FINISHED') {
          const pen = m.penalties ? ` (pens ${m.penalties.home}–${m.penalties.away})` : '';
          lines.push(`- ✅ **${m.team1} ${m.score1}–${m.score2} ${m.team2}**${pen} | Winner: ${m.winner}`);
        } else if (m.team1 !== 'TBD') {
          lines.push(`- 🔜 ${m.team1} vs ${m.team2} — ${m.dateSgt} ${m.timeSgt} SGT`);
        } else {
          lines.push(`- 🔜 TBD vs TBD`);
        }
      }
    }
    lines.push(``);
  }

  await writeNote('WC2026/knockout-bracket.md', lines.join('\n'));
}

// ─── PREDICTION INVALIDATION ──────────────────────────────────────────────────

/**
 * Read predictions.json safely.
 * @returns {object}
 */
function readPredictions() {
  try {
    if (!fs.existsSync(PREDICTIONS_FILE)) return {};
    return JSON.parse(fs.readFileSync(PREDICTIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * After a result comes in, clear predictions for both teams' next matches
 * so they regenerate with fresh tournament form data.
 * @param {string} team1
 * @param {string} team2
 * @param {object[]} fixtures
 * @param {object} results
 */
function invalidateNextMatchPredictions(team1, team2, fixtures, results) {
  const preds = readPredictions();
  let changed = false;

  for (const team of [team1, team2]) {
    const nextMatch = fixtures
      .filter((f) => (f.team1 === team || f.team2 === team) && !results[f.matchId])
      .sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso))[0];

    if (nextMatch && preds[nextMatch.matchId]) {
      delete preds[nextMatch.matchId];
      changed = true;
      console.log(`[LIVE] Prediction invalidated for ${nextMatch.matchId} — will regenerate with tournament data`);
    }
  }

  if (changed) {
    const tmp = PREDICTIONS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(preds, null, 2));
    fs.renameSync(tmp, PREDICTIONS_FILE);
  }
}

// ─── MAIN REFRESH ─────────────────────────────────────────────────────────────

/**
 * Run all Obsidian updates after a match result lands.
 * @param {string} team1
 * @param {string} team2
 * @param {object[]} fixtures
 * @param {object} results
 */
async function onResultReceived(team1, team2, fixtures, results) {
  console.log(`[LIVE] Running post-result Obsidian refresh after ${team1} vs ${team2}`);

  // Invalidate stale predictions before writing so regenerated ones use fresh data
  invalidateNextMatchPredictions(team1, team2, fixtures, results);

  // Write live data to Obsidian in parallel
  await Promise.allSettled([
    writeStandingsToObsidian(fixtures, results),
    writeTournamentFormToObsidian(fixtures, results),
  ]);

  console.log(`[LIVE] Post-result refresh complete`);
}

/**
 * Run full Obsidian refresh for knockout bracket.
 * @param {object} knockoutData
 */
async function onKnockoutResultReceived(knockoutData) {
  await writeKnockoutToObsidian(knockoutData);
}

module.exports = {
  computeStandings,
  computeTournamentForm,
  writeStandingsToObsidian,
  writeTournamentFormToObsidian,
  writeKnockoutToObsidian,
  invalidateNextMatchPredictions,
  onResultReceived,
  onKnockoutResultReceived,
};
