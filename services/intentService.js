'use strict';

const matchHandler = require('./queryHandlers/matchHandler');
const playerHandler = require('./queryHandlers/playerHandler');
const { handlePrediction, handleTournamentWinner, handleGroupPredictions, handleKnockoutRoundPrediction } = require('./queryHandlers/predictionHandler');
const standingsHandler = require('./queryHandlers/standingsHandler');
const teamHandler = require('./queryHandlers/teamHandler');
const knockoutHandler = require('./queryHandlers/knockoutHandler');
const { handlePoll } = require('./queryHandlers/pollHandler');
const generalHandler = require('./queryHandlers/generalHandler');

// ─── INTENT PATTERNS ─────────────────────────────────────────────────────────

const INTENTS = {
  // Commands (fast, local)
  CMD_SQUAD:       /^\/squad\b|^\/roster\b/i,
  CMD_TODAY:       /^\/today\b/i,
  CMD_TOMORROW:    /^\/tomorrow\b/i,
  CMD_PREDICT:     /^\/predict\b/i,
  CMD_POLL:        /^\/poll\b/i,
  NL_POLL:         /\b(create|make|start|open|launch|run|do)\s+a?\s*(community\s*)?poll\b|\blet'?s\s*vote\b|\bvote\s+(on|for)\b|\bcommunity\s*(poll|vote)\b/i,
  CMD_LINEUP:      /^\/lineup\b/i,
  CMD_INJURY:      /^\/injur/i,
  CMD_BRACKET:     /^\/bracket\b/i,
  CMD_GROUPS:      /^\/groups\b/i,
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
  MATCH_OPENING:   /\b(opening match|opening game|first match|first game|first day|day 1|day one|开幕战|开幕赛|第一天|首日)\b/i,
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
  PRED_KNOCKOUT_ROUND: /\b(predict.{0,30}(round of (32|16)|r32|r16|quarter.?final|semi.?final)|(round of (32|16)|r32|r16|quarter.?final|semi.?final).{0,30}predict)\b/i,
  PRED_WINMATCH:   /\b(who.{0,20}win|predict|going to win|will.{0,20}beat)\b/i,
  PRED_SCORE:      /\b(score.{0,20}predict|predict.{0,20}score|final score)\b/i,
  PRED_WINTOURNEY: /\b(who.{0,20}win.{0,20}(world cup|wc|tournament)|champion|lift.{0,10}trophy)\b/i,

  // Natural language — knockout
  KNOCKOUT_QUERY:  /\b(knockout|bracket|round of (16|32|sixteen|thirty)|quarter.?final|semi.?final|r16|r32|qf|sf|the final|who.{0,20}(win|won).{0,20}(final|cup|trophy)|champion|世界杯冠军|淘汰赛|四分之一|半决赛|决赛)\b/i,
  ROUND_QUERY:     /\b(round of (16|32)|quarter.?final|semi.?final|third.?place|3rd place|bronze|r16|r32|qf|sf)\b/i,

  // Natural language — standings / groups
  GROUPS_QUERY:    /\b(all.{0,15}group|grouping|group.{0,10}draw|show.{0,10}group|what.{0,20}(the )?group|list.{0,10}group|分组|小组赛)\b/i,
  STAND_GROUP:     /\b(group.{0,20}stand|stand.{0,20}group|table|points|top of group)\b/i,
  STAND_SCORER:    /\b(top scor|golden boot|most goal|leading scor)\b/i,

  // Natural language — team
  TEAM_INFO:       /\b(tell me about|about\s+the\s+team|team info)\b/i,
  TEAM_COMPARE:    /\bcompare\s+\w+\s+(and|vs)\s+\w+\b/i,

  // Squad queries
  SQUAD_QUERY:     /\b(squad|roster|who.{0,20}(in|on).{0,10}team|players.{0,20}(in|for)|full.{0,10}team)\b/i,
};

// ─── HELP MESSAGE ─────────────────────────────────────────────────────────────

const HELP_TEXT = `🤖 *FIFAWC26 — qwen3\\.6:35b Football Bot*

Use slash commands to interact with me\\!

📅 *Matches*
• /today — today's matches
• /tomorrow — tomorrow's matches

⚽ *Players \\& Squads*
• /squad Argentina
• /player Mbappe
• /injury Germany
• /lineup France
• /compare Mbappe Vinicius

🔮 *Predictions*
• /predict Brazil Morocco
• /poll Brazil Morocco \\— community poll \\+ AI hint
• /ask who will win Group C?
• /ask who wins the World Cup?

📊 *Standings \\& Stats*
• /groups — all 12 groups
• /group C — Group C table
• /topscorers
• /standings
• /stats

🏆 *Knockout Bracket*
• /bracket — full bracket \\(updates after Jun 28\\)

🧠 *Ask Anything*
• /ask Will Argentina retain the title?
• /ask How does Japan beat big teams?

_Powered by qwen3\\.6:35b running locally_ 🧠
─────────────────────────
🤖 *世界杯2026 — qwen3\\.6:35b 足球机器人*

使用斜杠命令与我互动\\！

📅 *赛程*
• /today — 今日赛程
• /tomorrow — 明日赛程

⚽ *球员与阵容*
• /squad 阿根廷
• /player 姆巴佩
• /injury 德国
• /lineup 法国
• /compare 姆巴佩 维尼修斯

🔮 *预测*
• /predict 巴西 摩洛哥
• /poll 巴西 摩洛哥 \\— 社区投票 \\+ AI预测
• /ask 哪队能赢得C组？
• /ask 谁会赢得世界杯？

📊 *积分榜与数据*
• /groups — 全部12个小组
• /group C — C组积分榜
• /topscorers — 最佳射手
• /standings — 积分排名
• /stats — 赛事数据

🏆 *淘汰赛*
• /bracket — 淘汰赛对阵图 \\(6月28日后更新\\)

🧠 *随便问*
• /ask 阿根廷能卫冕吗？
• /ask 日本如何击败强队？

_qwen3\\.6:35b 本地运行提供支持_ 🧠`;

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

  if (INTENTS.CMD_PREDICT.test(text)) return handlePrediction(text.replace(/^\/predict\s*/i, ''));
  if (INTENTS.CMD_POLL.test(text)) return handlePoll(text);
  if (INTENTS.NL_POLL.test(t)) {
    const cleaned = text
      .replace(/\b(create|make|start|open|launch|run|do)\s+a?\s*(community\s*)?poll\s*(for|on|about)?\s*/i, '')
      .replace(/\blet'?s\s*vote\s*(on|for)?\s*/i, '')
      .replace(/\bvote\s+(on|for)\s*/i, '')
      .replace(/\bcommunity\s*(poll|vote)\s*(on|for)?\s*/i, '')
      .trim();
    return handlePoll(`/poll ${cleaned}`);
  }
  if (INTENTS.CMD_LINEUP.test(text)) return playerHandler.handleLineup(text);
  if (INTENTS.CMD_INJURY.test(text)) return playerHandler.handleInjuries(text);
  if (INTENTS.CMD_PLAYER.test(text)) return playerHandler.handlePlayerInfo(text);
  if (INTENTS.CMD_COMPARE.test(text)) return playerHandler.handleCompare(text);

  if (INTENTS.CMD_BRACKET.test(text)) return knockoutHandler.handleBracket();
  if (INTENTS.CMD_GROUPS.test(text)) return standingsHandler.handleAllGroups();
  if (INTENTS.CMD_GROUP.test(text)) return standingsHandler.handleGroupStandings(text);
  if (INTENTS.CMD_TOPSCORERS.test(text)) return standingsHandler.handleTopScorers();
  if (INTENTS.CMD_STANDINGS.test(text)) return standingsHandler.handleAllStandings();
  if (INTENTS.CMD_STATS.test(text)) return standingsHandler.handleTournamentStats();

  if (INTENTS.CMD_RESULT.test(text)) return matchHandler.handleResult(text);
  if (INTENTS.CMD_NEXTMATCH.test(text)) return matchHandler.handleSchedule(3);
  if (INTENTS.CMD_ASK.test(text)) return generalHandler.handle(text.replace(/^\/ask\s*/i, ''), chatId);

  // ── Natural language — match ──
  if (INTENTS.MATCH_OPENING.test(t)) return matchHandler.handleOpeningDay();
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
  if (INTENTS.PRED_KNOCKOUT_ROUND.test(t)) return handleKnockoutRoundPrediction(text);
  if (INTENTS.PRED_WINTOURNEY.test(t)) return handleTournamentWinner();
  if (INTENTS.PRED_WINMATCH.test(t) || INTENTS.PRED_SCORE.test(t)) return handlePrediction(text);

  // ── Natural language — knockout bracket ──
  if (INTENTS.ROUND_QUERY.test(t)) return knockoutHandler.handleRound(t);
  if (INTENTS.KNOCKOUT_QUERY.test(t)) return knockoutHandler.handleBracket();

  // ── Natural language — standings / groups ──
  if (INTENTS.GROUPS_QUERY.test(t)) return standingsHandler.handleAllGroups();
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
