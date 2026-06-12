'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SCOUTING DEPT — HEAD SCOUT                                  ║
 * ║  Role: Enriches base team stats with live WC tournament data ║
 * ║  No Qwen call — pure data enrichment from JSON + Obsidian   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');

const OBSIDIAN_MCP   = 'http://localhost:3002';
const RESULTS_FILE   = path.join(__dirname, '../../data/match-results.json');
const QUALIFIER_FILE = path.join(__dirname, '../../data/qualifier-stats.json');

let _qualifierStats = null;
function getQualifierStats() {
  if (_qualifierStats) return _qualifierStats;
  try { _qualifierStats = JSON.parse(fs.readFileSync(QUALIFIER_FILE, 'utf8')); }
  catch { _qualifierStats = {}; }
  return _qualifierStats;
}

function readResults() {
  try {
    if (!fs.existsSync(RESULTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  } catch { return {}; }
}

function parseAbsences(content, teamName) {
  if (!content) return [];
  const lines = content.split('\n');
  const absences = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith('## ' + teamName)) { inSection = true; continue; }
    if (inSection && line.startsWith('## ')) break;
    if (inSection && (line.toLowerCase().includes('injur') || line.toLowerCase().includes('absent') || line.toLowerCase().includes('doubt') || line.toLowerCase().includes(' out'))) {
      const clean = line.replace(/^[-*\s]+/, '').trim();
      if (clean) absences.push(clean);
    }
  }
  return absences.slice(0, 3);
}

function computeTournamentStats(teamName, allResults) {
  const teamResults = allResults.filter((r) => r.team1 === teamName || r.team2 === teamName);
  let goalsFor = 0, goalsAgainst = 0;
  const formArr = [];
  for (const r of teamResults) {
    const isT1 = r.team1 === teamName;
    const gf = isT1 ? (r.score1 || 0) : (r.score2 || 0);
    const ga = isT1 ? (r.score2 || 0) : (r.score1 || 0);
    goalsFor += gf; goalsAgainst += ga;
    formArr.push(gf > ga ? 'W' : gf === ga ? 'D' : 'L');
  }
  const played = teamResults.length;
  return {
    tournamentPlayed:            played,
    tournamentGoalsFor:          played > 0 ? parseFloat((goalsFor / played).toFixed(2)) : null,
    tournamentGoalsAgainst:      played > 0 ? parseFloat((goalsAgainst / played).toFixed(2)) : null,
    tournamentForm:              formArr.slice(-5).join('') || '',
    tournamentGoalsForTotal:     goalsFor,
    tournamentGoalsAgainstTotal: goalsAgainst,
  };
}

/**
 * Enrich both teams' stats with live WC data, qualifier stats, and key absences.
 * @param {string} team1
 * @param {string} team2
 * @param {object} baseStats - TEAM_STATS constant
 * @returns {Promise<{ enriched1: object, enriched2: object }>}
 */
async function enrichTeamStats(team1, team2, baseStats) {
  const allResults = Object.values(readResults());
  const qualStats  = getQualifierStats();

  const base1 = baseStats[team1] || { rank: 99, goalsFor: 1.0, goalsAgainst: 1.5, form: 'DDDDD' };
  const base2 = baseStats[team2] || { rank: 99, goalsFor: 1.0, goalsAgainst: 1.5, form: 'DDDDD' };

  const t1 = computeTournamentStats(team1, allResults);
  const t2 = computeTournamentStats(team2, allResults);
  const q1 = qualStats[team1] || null;
  const q2 = qualStats[team2] || null;

  let squadNoteContent = '';
  try {
    const resp = await fetch(OBSIDIAN_MCP + '/read/' + encodeURIComponent('WC2026/squad-news.md'), { timeout: 4000 });
    const data = await resp.json();
    squadNoteContent = data.content || '';
  } catch { /* non-fatal */ }

  const absences1 = parseAbsences(squadNoteContent, team1);
  const absences2 = parseAbsences(squadNoteContent, team2);

  const enriched1 = Object.assign({}, base1, t1, { qualifier: q1, keyAbsences: absences1 });
  const enriched2 = Object.assign({}, base2, t2, { qualifier: q2, keyAbsences: absences2 });

  console.log(`[SCOUTING] ${team1}: ${t1.tournamentPlayed} WC games | qualifier: ${q1 ? `${q1.won}W-${q1.drawn}D-${q1.lost}L` : 'no data'}`);
  console.log(`[SCOUTING] ${team2}: ${t2.tournamentPlayed} WC games | qualifier: ${q2 ? `${q2.won}W-${q2.drawn}D-${q2.lost}L` : 'no data'}`);

  return { enriched1, enriched2 };
}

/**
 * Format a team's enriched profile as a readable text block for Qwen prompts.
 * @param {string} teamName
 * @param {object} stats - enriched stats
 * @returns {string}
 */
function formatTeamProfile(teamName, stats) {
  const lines = [
    `${teamName}:`,
    `  FIFA Ranking: #${stats.rank}`,
    `  Pre-tournament: ${stats.goalsFor} gf/g | ${stats.goalsAgainst} ga/g | Form: ${stats.form}`,
  ];

  if (stats.tournamentPlayed > 0) {
    lines.push(`  WC2026 (${stats.tournamentPlayed} game${stats.tournamentPlayed !== 1 ? 's' : ''}): ${stats.tournamentGoalsFor} gf/g | ${stats.tournamentGoalsAgainst} ga/g | Form: ${stats.tournamentForm}`);
    lines.push(`  NOTE: Tournament form overrides pre-tournament stats.`);
  } else {
    lines.push(`  WC2026: No games played yet.`);
  }

  if (stats.qualifier) {
    const q    = stats.qualifier;
    const gfpg = q.played > 0 ? (q.goalsFor     / q.played).toFixed(2) : '?';
    const gapg = q.played > 0 ? (q.goalsAgainst / q.played).toFixed(2) : '?';
    const gd   = (q.goalDiff >= 0 ? '+' : '') + q.goalDiff;
    const via  = (q.method || '').replace(/_/g, ' ');
    lines.push(`  Qualifying (${q.confederation || '?'}): ${q.won}W-${q.drawn}D-${q.lost}L | GF/g: ${gfpg} | GA/g: ${gapg} | GD: ${gd} | via: ${via}`);
    if (q.note) lines.push(`  Qualifier note: ${q.note}`);
  }

  if (stats.keyAbsences && stats.keyAbsences.length > 0) {
    lines.push(`  Key absences: ${stats.keyAbsences.join('; ')}`);
  }

  return lines.join('\n');
}

module.exports = { enrichTeamStats, formatTeamProfile };
