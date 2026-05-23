'use strict';

const matchHandler = require('./queryHandlers/matchHandler');
const playerHandler = require('./queryHandlers/playerHandler');
const predictionHandler = require('./queryHandlers/predictionHandler');
const standingsHandler = require('./queryHandlers/standingsHandler');
const teamHandler = require('./queryHandlers/teamHandler');
const generalHandler = require('./queryHandlers/generalHandler');

// ─── INTENT PATTERNS ─────────────────────────────────────────────────────────

const INTENTS = {
  // Commands (fast, local)
  CMD_SQUAD:       /^\/squad\b|^\/roster\b/i,
  CMD_TODAY:       /^\/today\b/i,
  CMD_TOMORROW:    /^\/tomorrow\b/i,
  CMD_PREDICT:     /^\/predict\b/i,
  CMD_LINEUP:      /^\/lineup\b/i,
  CMD_INJURY:      /^\/injur/i,
  CMD_GROUP:       /^\/group\b/i,
  CMD_PLAYER:      /^\/player\b/i,
  CMD_TOPSCORERS:  /^\/topscorers?\b/i,
  CMD_STANDINGS:   /^\/standings?\b/i,
  CMD_COMPARE:     /^\/compare\b/i,
  CMD_NEXTMATCH:   /^\/nextmatch\b/i,
  CMD_RESULT:      /^\/result\b/i,
  CMD_ASK:         /^\/ask\b/i,
  CMD_STATS:       /^\/stats\b/i,
  CMD_HELP:        /^\/(help|start)\b/i,

  // Natural language — match
  MATCH_TODAY:     /\b(today|tonight|now playing|happening now)\b/i,
  MATCH_TOMORROW:  /\b(tomorrow|next match|upcoming|when.{0,20}(play|kick))\b/i,
  MATCH_TIME:      /\b(what time|when is|kickoff|kick.?off|what time)\b/i,
  MATCH_RESULT:    /\b(result|final score|what.{0,20}(happen|end|score))\b/i,
  MATCH_SCHEDULE:  /\b(schedule|fixture|calendar|all match|full list)\b/i,

  // Natural language — player
  PLAYER_INJURY:   /\b(injur|hurt|fit|doubt|unavailable|who.{0,20}(miss|out))\b/i,
  PLAYER_LINEUP:   /\b(lineup|starting|who.{0,20}(play|start)|starting xi)\b/i,
  PLAYER_COMPARE:  /\b(compare|who.{0,10}better|versus)\b.{0,30}\b(and|vs)\b/i,
  PLAYER_STATS:    /\b(stats|goals|assists|how many.{0,20}(goal|score)|rating)\b/i,

  // Natural language — prediction
  PRED_WINMATCH:   /\b(who.{0,20}win|predict|going to win|will.{0,20}beat)\b/i,
  PRED_SCORE:      /\b(score.{0,20}predict|predict.{0,20}score|final score)\b/i,
  PRED_WINTOURNEY: /\b(who.{0,20}win.{0,20}(world cup|wc|tournament)|champion|lift.{0,10}trophy)\b/i,

  // Natural language — standings
  STAND_GROUP:     /\b(group.{0,20}stand|stand.{0,20}group|table|points|top of group)\b/i,
  STAND_SCORER:    /\b(top scor|golden boot|most goal|leading scor)\b/i,

  // Natural language — team
  TEAM_INFO:       /\b(tell me about|about\s+the\s+team|team info)\b/i,
  TEAM_COMPARE:    /\bcompare\s+\w+\s+(and|vs)\s+\w+\b/i,

  // Squad queries
  SQUAD_QUERY:     /\b(squad|roster|who.{0,20}(in|on).{0,10}team|players.{0,20}(in|for)|full.{0,10}team)\b/i,
};

// ─── HELP MESSAGE ─────────────────────────────────────────────────────────────

const HELP_TEXT = `🤖 *FIFAWC26 — qwen3\\.5:35b Football Bot*

Ask me anything about WC2026\\!

📅 *Matches*
• "today's matches"
• "what time is Brazil vs Morocco?"
• /tomorrow

⚽ *Players \\& Squads*
• /squad Argentina
• /player Mbappe
• /injury Germany
• /lineup France
• /compare Mbappe Vinicius

🔮 *Predictions*
• /predict Brazil Morocco
• "who will win Group C?"
• "who wins the World Cup?"

📊 *Standings \\& Stats*
• /group C
• /topscorers
• /standings
• /stats

🧠 *Ask Anything*
• /ask Will Argentina retain the title?
• /ask How does Japan beat big teams?
• "who are the upset risks this week?"

_Powered by qwen3\\.5:35b running locally_ 🧠`;

// ─── ROUTER ───────────────────────────────────────────────────────────────────

/**
 * Classify message intent and route to the correct handler.
 * @param {object} msg - Telegram message object
 * @param {string|number} chatId
 * @returns {Promise<string>} Response text
 */
async function classifyAndHandle(msg, chatId) {
  const text = (msg.text || '').trim();
  const t = text.toLowerCase();

  // ── Slash commands ──
  if (INTENTS.CMD_HELP.test(text)) return HELP_TEXT;
  if (INTENTS.CMD_SQUAD.test(text)) return playerHandler.handleSquad(text.replace(/^\/(squad|roster)\s*/i, '').trim());
  if (INTENTS.CMD_TODAY.test(text)) return matchHandler.handleToday();
  if (INTENTS.CMD_TOMORROW.test(text)) return matchHandler.handleTomorrow();

  if (INTENTS.CMD_PREDICT.test(text)) return predictionHandler.handlePrediction(text.replace(/^\/predict\s*/i, ''));
  if (INTENTS.CMD_LINEUP.test(text)) return playerHandler.handleLineup(text);
  if (INTENTS.CMD_INJURY.test(text)) return playerHandler.handleInjuries(text);
  if (INTENTS.CMD_PLAYER.test(text)) return playerHandler.handlePlayerInfo(text);
  if (INTENTS.CMD_COMPARE.test(text)) return playerHandler.handleCompare(text);

  if (INTENTS.CMD_GROUP.test(text)) return standingsHandler.handleGroupStandings(text);
  if (INTENTS.CMD_TOPSCORERS.test(text)) return standingsHandler.handleTopScorers();
  if (INTENTS.CMD_STANDINGS.test(text)) return standingsHandler.handleAllStandings();
  if (INTENTS.CMD_STATS.test(text)) return standingsHandler.handleTournamentStats();

  if (INTENTS.CMD_RESULT.test(text)) return matchHandler.handleResult(text);
  if (INTENTS.CMD_NEXTMATCH.test(text)) return matchHandler.handleSchedule(3);
  if (INTENTS.CMD_ASK.test(text)) return generalHandler.handle(text.replace(/^\/ask\s*/i, ''), chatId);

  // ── Natural language — match ──
  if (INTENTS.MATCH_TODAY.test(t)) return matchHandler.handleToday();
  if (INTENTS.MATCH_TOMORROW.test(t)) return matchHandler.handleTomorrow();
  if (INTENTS.MATCH_TIME.test(t)) return matchHandler.handleMatchTime(text);
  if (INTENTS.MATCH_RESULT.test(t) && !INTENTS.PRED_SCORE.test(t)) return matchHandler.handleResult(text);
  if (INTENTS.MATCH_SCHEDULE.test(t)) return matchHandler.handleSchedule();

  // ── Natural language — player ──
  if (INTENTS.PLAYER_INJURY.test(t)) return playerHandler.handleInjuries(text);
  if (INTENTS.PLAYER_LINEUP.test(t)) return playerHandler.handleLineup(text);
  if (INTENTS.PLAYER_COMPARE.test(t)) return playerHandler.handleCompare(text);

  // ── Natural language — prediction ──
  if (INTENTS.PRED_WINTOURNEY.test(t)) return predictionHandler.handleTournamentWinner();
  if (INTENTS.PRED_WINMATCH.test(t) || INTENTS.PRED_SCORE.test(t)) return predictionHandler.handlePrediction(text);

  // ── Natural language — standings ──
  if (INTENTS.STAND_GROUP.test(t)) return standingsHandler.handleGroupStandings(text);
  if (INTENTS.STAND_SCORER.test(t)) return standingsHandler.handleTopScorers();

  // ── Natural language — squad ──
  if (INTENTS.SQUAD_QUERY.test(t)) return playerHandler.handleSquad(text);

  // ── Natural language — team ──
  if (INTENTS.TEAM_COMPARE.test(t)) return teamHandler.handleTeamCompare(text);
  if (INTENTS.TEAM_INFO.test(t)) return teamHandler.handleTeamInfo(text);

  // ── Fallback → Qwen ──
  return generalHandler.handle(text, chatId);
}

module.exports = { classifyAndHandle, HELP_TEXT };
