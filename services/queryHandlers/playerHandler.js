'use strict';

const fetch = require('node-fetch');
const { getCache, callOllamaQueued, escapeMd, formatForTelegram } = require('../chatService');
const { MASTER_SYSTEM_PROMPT } = require('../qwenPersonality');
const { findSquad } = require('../squadsData');

const OBSIDIAN_MCP = 'http://localhost:3002';

async function readNote(filename) {
  try {
    const r = await fetch(`${OBSIDIAN_MCP}/read?filename=${encodeURIComponent(filename)}`, { timeout: 3000 });
    const d = await r.json();
    return d.content || '';
  } catch {
    return '';
  }
}

const KNOWN_PLAYERS = {
  mbappe: 'France', vinicius: 'Brazil', haaland: 'Norway',
  musiala: 'Germany', wirtz: 'Germany', bellingham: 'England',
  kane: 'England', salah: 'Egypt', messi: 'Argentina',
  ronaldo: 'Portugal', neymar: 'Brazil', lewandowski: 'Poland',
  morata: 'Spain', yamal: 'Spain', pedri: 'Spain',
  saka: 'England', rashford: 'England', rice: 'England',
  dembele: 'France', griezmann: 'France', tchouameni: 'France',
  hakimi: 'Morocco', ennesyri: 'Morocco', ziyech: 'Morocco',
  martinez: 'Argentina', pulisic: 'USA', weah: 'USA',
  reyna: 'USA', mckennie: 'USA', davies: 'Canada', david: 'Canada',
  son: 'South Korea', kimminjaae: 'South Korea', gakpo: 'Netherlands',
  debruyne: 'Belgium', lukaku: 'Belgium', kubo: 'Japan', mitoma: 'Japan',
};

function findPlayerTeam(name) {
  const lower = name.toLowerCase();
  for (const [key, team] of Object.entries(KNOWN_PLAYERS)) {
    if (lower.includes(key)) return team;
  }
  return null;
}

/**
 * Handle squad query — instant response from SQUADS data, no Qwen needed.
 * @param {string} teamName
 */
async function handleSquad(teamName) {
  if (!teamName || teamName.length < 2) {
    return `❓ Specify a team: /squad Argentina\n\nAvailable: Argentina, Brazil, France, England, Germany, Spain, Portugal, Morocco, Japan, USA, Mexico, Canada, South Korea, Netherlands, Belgium, Australia`;
  }

  const { teamStats } = await getCache();
  const entry = findSquad(teamName);

  if (!entry) {
    const generalHandler = require('./generalHandler');
    return generalHandler.handle(`List the WC2026 squad for ${teamName} with their clubs and known stats`, null);
  }

  const [team, squad] = entry;
  const stats = teamStats[team] || {};

  const fmt = (p) => {
    let line = `• *${escapeMd(p.name)}* \\(${escapeMd(p.club)}\\)`;
    if (p.goals !== undefined) line += ` — ${p.goals}G/${p.assists}A`;
    if (p.wcGoals !== undefined) line += ` · ${p.wcGoals} WC⚽`;
    return line;
  };

  return [
    `🌍 *${escapeMd(team)} — WC2026 Squad*`,
    ``,
    `🥅 *GK*`,
    ...squad.GK.map(fmt),
    ``,
    `🛡 *Defenders*`,
    ...squad.DEF.map(fmt),
    ``,
    `⚙️ *Midfield*`,
    ...squad.MID.map(fmt),
    ``,
    `⚡ *Attack*`,
    ...squad.FWD.map(fmt),
    ``,
    `📊 *Team Stats*`,
    `Goals/game: ${escapeMd(String(stats.goalsFor || '—'))} \\| Conceded: ${escapeMd(String(stats.goalsAgainst || '—'))}`,
    `FIFA Rank: \\#${escapeMd(String(stats.rank || '—'))} \\| Form: \`${escapeMd(stats.form || '—')}\``,
    ``,
    `_qwen3\\.5:35b_`,
  ].join('\n');
}

/**
 * Handle player info query.
 * @param {string} text
 */
async function handlePlayerInfo(text) {
  const words = text.replace(/^\/player\s*/i, '').trim();
  if (!words) return `❓ Specify a player: /player Mbappe`;

  const team = findPlayerTeam(words);
  const injuryNote = await readNote('WC2026/injuries.md');
  const injuryLines = injuryNote
    ? injuryNote.split('\n').filter((l) => l.toLowerCase().includes(words.toLowerCase())).slice(0, 3).join('\n')
    : '';

  const prompt = `${MASTER_SYSTEM_PROMPT}

PLAYER: ${words}${team ? `\nTEAM: ${team}` : ''}
${injuryLines ? `INJURY DATA:\n${injuryLines}` : ''}

Use the PLAYER QUERY template. Fill in real stats where you know them; say "no data" if unsure.`;

  const answer = await callOllamaQueued(prompt);
  return formatForTelegram(answer) || `❓ No data found for ${escapeMd(words)}`;
}

/**
 * Handle injury report for a team.
 * @param {string} text
 */
async function handleInjuries(text) {
  const teamName = text.replace(/^\/(injury|injur[y]?)\s*/i, '').replace(/who.*injur.*in\s*/i, '').trim();
  const injuryNote = await readNote('WC2026/injuries.md');

  if (!injuryNote) {
    return `🚑 No injury data available\\. Update vault/WC2026/injuries\\.md to track injuries\\.`;
  }

  if (teamName) {
    const lines = injuryNote.split('\n').filter((l) => l.toLowerCase().includes(teamName.toLowerCase()));
    if (lines.length === 0) return `✅ *${escapeMd(teamName)}* — No confirmed injuries on record\\.`;
    return `🚑 *${escapeMd(teamName)} Injury Report*\n\n${escapeMd(lines.join('\n'))}\n\n_Source: injuries\\.md_`;
  }

  return `🚑 *WC2026 Injury Tracker*\n\n${escapeMd(injuryNote.slice(0, 800))}\n\n_Source: injuries\\.md_`;
}

/**
 * Handle expected lineup for a team.
 * @param {string} text
 */
async function handleLineup(text) {
  const teamName = text.replace(/^\/(lineup|xi|starting)\s*/i, '').replace(/who.*(play|start).*for\s*/i, '').trim();
  if (!teamName) return `❓ Specify a team: /lineup France`;

  // Check if we have squad data — use it for context
  const entry = findSquad(teamName);
  const { teamStats } = await getCache();
  const stats = entry ? teamStats[entry[0]] || {} : {};

  let squadContext = '';
  if (entry) {
    const [team, squad] = entry;
    const allPlayers = [...squad.GK, ...squad.DEF, ...squad.MID, ...squad.FWD]
      .map((p) => `${p.name} (${p.club})`)
      .join(', ');
    squadContext = `KNOWN SQUAD: ${allPlayers}`;
  }

  const prompt = `${MASTER_SYSTEM_PROMPT}

TEAM: ${teamName}
FORM: ${stats.form || 'unknown'}
${squadContext}

Predict the most likely starting XI. Format:
Formation: X-X-X
GK: Name (Club)
DEF: Name, Name, Name
MID: Name, Name, Name
FWD: Name, Name, Name
Coach: Name

Only the lineup — no lengthy explanation.`;

  const answer = await callOllamaQueued(prompt);
  return `📋 *${escapeMd(teamName)} — Expected XI*\n\n${formatForTelegram(answer)}\n\n_Predicted by qwen3\\.5:35b — confirm 1hr before kickoff_`;
}

/**
 * Handle player comparison.
 * @param {string} text
 */
async function handleCompare(text) {
  const cleaned = text.replace(/^\/(compare|vs)\s*/i, '').trim();
  const parts = cleaned.split(/\s+vs\s+|\s+and\s+|\s{2,}/i);
  const p1 = parts[0]?.trim() || '';
  const p2 = parts[1]?.trim() || '';

  if (!p1 || !p2) return `❓ Compare two players: /compare Mbappe Vinicius`;

  const prompt = `${MASTER_SYSTEM_PROMPT}

PLAYER 1: ${p1} (${findPlayerTeam(p1) || 'team unknown'})
PLAYER 2: ${p2} (${findPlayerTeam(p2) || 'team unknown'})

Use the COMPARISON template. Be decisive with a clear verdict.`;

  const answer = await callOllamaQueued(prompt);
  return formatForTelegram(answer) || `❓ Could not compare ${escapeMd(p1)} and ${escapeMd(p2)}`;
}

module.exports = { handlePlayerInfo, handleInjuries, handleLineup, handleCompare, handleSquad };
