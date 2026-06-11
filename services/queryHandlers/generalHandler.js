'use strict';

/**
 * General Handler — Smart Context Injection
 *
 * Extracts team names from the question, loads their vault notes +
 * qualifier stats + H2H data, and builds a targeted context block
 * instead of the generic data dump. Much better Qwen answers.
 */

const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const { getChatHistory, buildFullContext, callOllamaQueued, needsThinking, formatForTelegram, getCache } = require('../chatService');
const { MASTER_SYSTEM_PROMPT } = require('../qwenPersonality');
const { findFixture, buildPollData } = require('./pollHandler');

const OBSIDIAN_MCP   = 'http://localhost:3002';
const QUALIFIER_FILE = path.join(__dirname, '../../data/qualifier-stats.json');

const PRED_WIN_RE = /\b(who.{0,20}win|predict|going to win|will.{0,20}beat|who.{0,15}(better|stronger|favou?rite))\b/i;

// All 48 teams + common aliases
const ALL_TEAMS = [
  'Argentina','France','Spain','England','Brazil','Portugal','Netherlands','Colombia',
  'Croatia','Belgium','Germany','Morocco','Uruguay','Mexico','USA','Japan',
  'Switzerland','Senegal','South Korea','Australia','Sweden','Norway','Austria',
  'Turkiye','Iran','Ecuador','Scotland','Czechia','Tunisia','Egypt','Qatar',
  'Ivory Coast','Canada','Bosnia','Bosnia and Herzegovina','Paraguay','Haiti',
  'Curacao','New Zealand','Cape Verde','Saudi Arabia','Iraq','Algeria','Jordan',
  'DR Congo','Uzbekistan','Ghana','Panama','South Africa',
  'Turkey','United States','Korea','America',
];

const TEAM_ALIASES = {
  'turkey': 'Turkiye', 'united states': 'USA', 'america': 'USA',
  'korea': 'South Korea', 'bosnia': 'Bosnia and Herzegovina',
  'czech republic': 'Czechia',
};

// Cache qualifier stats after first read
let _qualCache = null;
function getQualifierStats() {
  if (_qualCache) return _qualCache;
  try { _qualCache = JSON.parse(fs.readFileSync(QUALIFIER_FILE, 'utf8')); }
  catch { _qualCache = {}; }
  return _qualCache;
}

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTeams(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const team of ALL_TEAMS) {
    const canonical = TEAM_ALIASES[team.toLowerCase()] || team;
    if (lower.includes(team.toLowerCase()) && !found.includes(canonical)) {
      found.push(canonical);
    }
    if (found.length >= 2) break;
  }
  return found;
}

async function fetchTeamNote(teamName) {
  const slug = teamName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  try {
    const resp = await fetch(OBSIDIAN_MCP + '/read/' + encodeURIComponent('WC2026/teams/' + slug + '.md'), { timeout: 3000 });
    const data = await resp.json();
    if (data.content && data.content.length > 50) return data.content.slice(0, 900);
  } catch {}
  try {
    const resp = await fetch(OBSIDIAN_MCP + '/search?q=' + encodeURIComponent(teamName), { timeout: 3000 });
    const data = await resp.json();
    if (data.results && data.results[0]) return data.results[0].content.slice(0, 900);
  } catch {}
  return '';
}

async function fetchH2H(team1, team2) {
  try {
    const resp = await fetch(OBSIDIAN_MCP + '/read/' + encodeURIComponent('WC2026/head-to-head.md'), { timeout: 3000 });
    const data = await resp.json();
    if (!data.content) return '';
    const lines = data.content.split('\n');
    const pat = new RegExp(escapeRe(team1) + '.*' + escapeRe(team2) + '|' + escapeRe(team2) + '.*' + escapeRe(team1), 'i');
    let inSection = false;
    const out = [];
    for (const line of lines) {
      if (line.startsWith('## ') && pat.test(line)) { inSection = true; out.push(line); continue; }
      if (inSection && line.startsWith('## ')) break;
      if (inSection) out.push(line);
    }
    return out.join('\n').trim();
  } catch { return ''; }
}

function selectTemplate(text, teams) {
  const t = text.toLowerCase();
  if (teams.length === 2) {
    if (/predict|win|beat|score|who.{0,15}(better|stronger)/i.test(t)) return 'Use the PREDICTION template.';
    if (/compare|vs|versus|difference|better/i.test(t)) return 'Use COMPARISON template for the two teams.';
    return 'Use GENERAL/ASK template, covering both ' + teams[0] + ' and ' + teams[1] + '.';
  }
  if (teams.length === 1) {
    if (/squad|roster|players|lineup/i.test(t)) return 'Use the SQUAD QUERY template.';
    if (/injur|fit|doubt|available/i.test(t)) return 'Focus on injury/fitness. Use PLAYER QUERY template.';
    if (/qualif|how.{0,15}(playing|performed|form)/i.test(t)) return 'Summarise qualifying campaign and current form. Use GENERAL/ASK template.';
    return 'Use GENERAL/ASK template, focused on ' + teams[0] + '.';
  }
  if (/top scor|golden boot|most goal/i.test(t)) return 'List top scorers from the data with exact numbers.';
  if (/group|standing|table/i.test(t)) return 'Present standings clearly. One group per section.';
  if (/champion|who win.{0,20}(world cup|tournament)/i.test(t)) return 'Give analytical verdict with probabilities. GENERAL/ASK template.';
  return 'Use the GENERAL/ASK template.';
}

async function buildTargetedContext(question, teams, cache) {
  const qualStats = getQualifierStats();
  const parts = [];

  const todaySgt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  parts.push('FIFA World Cup 2026 | June 11-July 19, 2026 | USA/Canada/Mexico | Today: ' + todaySgt);

  const todayMatches = (cache.fixtures || []).filter(function(f) {
    return new Date(f.dateIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }) === todaySgt;
  });
  if (todayMatches.length > 0) {
    parts.push('TODAY: ' + todayMatches.map(function(f) { return f.team1 + ' vs ' + f.team2 + ' ' + f.timeSgt + ' SGT'; }).join(' | '));
  }

  for (const team of teams.slice(0, 2)) {
    const note = await fetchTeamNote(team);
    const qual = qualStats[team];
    const ts   = (cache.teamStats || {})[team];

    const section = ['\n=== ' + team.toUpperCase() + ' ==='];
    if (ts) section.push('FIFA Rank: #' + ts.rank + ' | Form: ' + ts.form + ' | GF/g: ' + ts.goalsFor + ' | GA/g: ' + ts.goalsAgainst);
    if (qual) {
      const gfpg = qual.played > 0 ? (qual.goalsFor / qual.played).toFixed(2) : '?';
      const gapg = qual.played > 0 ? (qual.goalsAgainst / qual.played).toFixed(2) : '?';
      const gd   = (qual.goalDiff >= 0 ? '+' : '') + qual.goalDiff;
      section.push('Qualifying (' + qual.confederation + '): ' + qual.won + 'W-' + qual.drawn + 'D-' + qual.lost + 'L | GF/g: ' + gfpg + ' | GA/g: ' + gapg + ' | GD: ' + gd);
      if (qual.note) section.push('Note: ' + qual.note);
    }
    if (note) section.push(note);
    parts.push(section.join('\n'));
  }

  if (teams.length === 2) {
    const h2h = await fetchH2H(teams[0], teams[1]);
    if (h2h) parts.push('\n=== HEAD-TO-HEAD ===\n' + h2h);

    const fixture = (cache.fixtures || []).find(function(f) {
      return (f.team1 === teams[0] && f.team2 === teams[1]) || (f.team1 === teams[1] && f.team2 === teams[0]);
    });
    if (fixture && cache.predictions && cache.predictions[fixture.matchId]) {
      const p = cache.predictions[fixture.matchId];
      parts.push(
        '\n=== EXISTING AI PREDICTION ===',
        'Winner: ' + p.winner + ' | Score: ' + p.predicted_score + ' | Confidence: ' + p.confidence + '%',
        'Analysis: ' + (p.analysis_summary || ''),
        'Key factors: ' + (p.key_factors || []).join('; ')
      );
    }
  }

  const recentRes = Object.entries(cache.results || {}).slice(-3);
  if (recentRes.length) parts.push('\nRECENT RESULTS: ' + recentRes.map(function(e) { return e[0] + ' -> ' + e[1].score1 + '-' + e[1].score2; }).join(' | '));

  return parts.filter(Boolean).join('\n');
}

async function handle(text, chatId) {
  const think     = needsThinking(text);
  const cleanText = text.replace(/^\/(think|no_think|ask)\s*/i, '').trim();
  const teams     = extractTeams(cleanText);

  console.log('[CHATBOT] thinking=' + think + ' teams=[' + teams.join(', ') + '] — "' + cleanText.slice(0, 60) + '"');

  const history = getChatHistory(chatId, 4);
  const cache   = await getCache();

  let context;
  try { context = await buildTargetedContext(cleanText, teams, cache); }
  catch { context = await buildFullContext(); }

  const historyStr = history.map(function(m) {
    return (m.role === 'user' ? 'User' : 'Bot') + ': ' + m.text;
  }).join('\n');

  const templateHint = selectTemplate(cleanText, teams);

  const prompt = MASTER_SYSTEM_PROMPT + '\n\n' +
    '====== CONTEXT ======\n' +
    context + '\n' +
    '====== END CONTEXT ======\n' +
    (historyStr ? '\nCHAT HISTORY:\n' + historyStr + '\n' : '') +
    '\nUSER: ' + cleanText + '\n\n' +
    'INSTRUCTION: ' + templateHint + ' Use ONLY facts from CONTEXT. Do not invent stats.';

  const answer    = await callOllamaQueued(prompt, think);
  const formatted = formatForTelegram(answer) || '❓ No response — try rephrasing.';

  // Auto-attach community poll for "who wins" questions with two teams
  if (PRED_WIN_RE.test(cleanText) && teams.length === 2) {
    try {
      const fixture = findFixture(cache.fixtures, cleanText);
      if (fixture) {
        const pollData = buildPollData(fixture, cache.predictions);
        return { type: 'poll_with_text', text: formatted, ...pollData };
      }
    } catch {}
  }

  return formatted;
}

module.exports = { handle };
