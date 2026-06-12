'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  STRATEGY DEPT — CLUB HISTORIAN                             ║
 * ║  Role: Extract and interpret head-to-head records           ║
 * ║  ✅ CODE-ONLY — No Qwen call                                ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Reads the H2H vault note, extracts the relevant matchup section,
 * detects revenge narratives, and infers historical edge.
 * The Chief Strategist does the reasoning — Historian just supplies the facts.
 */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractH2HSection(content, team1, team2) {
  if (!content) return '';
  const lines   = content.split('\n');
  const pattern = new RegExp(
    `${escapeRegex(team1)}.*${escapeRegex(team2)}|${escapeRegex(team2)}.*${escapeRegex(team1)}`,
    'i'
  );
  let inSection = false;
  const out = [];
  for (const line of lines) {
    if (line.startsWith('## ') && pattern.test(line)) { inSection = true; out.push(line); continue; }
    if (inSection && line.startsWith('## ')) break;
    if (inSection) out.push(line);
  }
  return out.join('\n').trim();
}

function detectRevengeNarrative(h2hText) {
  return /REVENGE/i.test(h2hText);
}

function inferH2HEdge(h2hText, team1, team2) {
  if (!h2hText || h2hText.length < 20) return 'neutral';
  const t1Wins = (h2hText.match(new RegExp(`${escapeRegex(team1)}\\s+(won|beat|beats|win)`, 'gi')) || []).length;
  const t2Wins = (h2hText.match(new RegExp(`${escapeRegex(team2)}\\s+(won|beat|beats|win)`, 'gi')) || []).length;
  if (t1Wins > t2Wins) return team1;
  if (t2Wins > t1Wins) return team2;
  return 'neutral';
}

/**
 * Run the Club Historian — code-only, reads vault H2H content.
 * @param {string} team1
 * @param {string} team2
 * @param {string} h2hRawContent - full content of WC2026/head-to-head.md
 * @returns {object}
 */
function runHistorianAgent(team1, team2, h2hRawContent) {
  const h2hSection       = extractH2HSection(h2hRawContent, team1, team2);
  const hasData          = h2hSection.length > 20;
  const revengeNarrative = hasData && detectRevengeNarrative(h2hSection);
  const h2hEdge          = hasData ? inferH2HEdge(h2hSection, team1, team2) : 'neutral';

  console.log(`[STRATEGY:HISTORIAN] ${team1} vs ${team2} — H2H data: ${hasData} | revenge: ${revengeNarrative} | edge: ${h2hEdge}`);

  return {
    h2hSection,
    hasData,
    h2hEdge,
    revengeNarrative,
    h2hWeight: hasData ? 0.15 : 0.05,
    _source:   'vault',
  };
}

/**
 * Format historian report as text block for Chief Strategist prompt.
 * @param {object} report
 * @param {string} team1
 * @param {string} team2
 * @returns {string}
 */
function formatHistorianReport(report, team1, team2) {
  if (!report.hasData) {
    return `📖 HEAD-TO-HEAD HISTORY:\nNo specific H2H data in vault. Limited or no competitive history. Weight low (${report.h2hWeight}).`;
  }

  const edgeLabel = report.h2hEdge === team1 ? team1 : report.h2hEdge === team2 ? team2 : 'neutral';
  const lines = [
    `📖 HEAD-TO-HEAD HISTORY (vault data — weight: ${report.h2hWeight}):`,
    report.h2hSection,
    report.revengeNarrative ? '\n*** REVENGE NARRATIVE DETECTED — factor into motivation and intensity ***' : '',
    `H2H edge hint: ${edgeLabel} (Chief Strategist should reason from the above records)`,
  ];
  return lines.filter(Boolean).join('\n');
}

module.exports = { runHistorianAgent, formatHistorianReport };
