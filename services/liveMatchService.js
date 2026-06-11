'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const { espnNameMatches, espnStat, sofascoreNameMatches } = require('./resultsService');
const { escapeMd, isAlertSent, markAlertSent, sendToChannel } = require('./alertService');
const { toZh } = require('./countryNames');
const { computeLiveOutlook, refreshLiveAnalysis, readPreMatchPrediction } = require('./livePredictionService');

const LIVE_FILE = path.join(__dirname, '../data/live-matches.json');
const OBSIDIAN_MCP = 'http://localhost:3002';
const FIFA_COMPETITION_ID = '17';

// Match window: start polling 10min before kickoff, stop 150min after
const PRE_KICKOFF_MS = 10 * 60000;
const POST_KICKOFF_MS = 150 * 60000;

// FIFA MatchStatus codes (from live FIFA website network calls)
const FIFA_STATUS_FINISHED = 0;
const FIFA_STATUS_LIVE = 3;

// In-match refresh cadence: live stats + Qwen re-analysis every 5 minutes
const LIVE_REFRESH_MS = 5 * 60000;

// Latest Qwen in-match analyses, merged into the store on each poll
const liveAnalysisCache = {};
// Latest live ESPN stats per match: { stats, fetchedAt }
const liveStatsCache = {};
// Timestamp of the last Qwen re-analysis trigger per match
const lastAnalysisAt = {};

// ─── LIVE STORE (atomic) ─────────────────────────────────────────────────────

/**
 * Read live-matches.json safely.
 * @returns {{ matches: object, lastUpdated: string|null }}
 */
function readLiveStore() {
  try {
    if (!fs.existsSync(LIVE_FILE)) return { matches: {}, lastUpdated: null };
    return JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  } catch {
    return { matches: {}, lastUpdated: null };
  }
}

/**
 * Write the live store atomically (write .tmp → rename).
 * @param {{ matches: object, lastUpdated: string }} store
 */
function writeLiveStore(store) {
  const tmp = LIVE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, LIVE_FILE);
}

// ─── DATE HELPERS ────────────────────────────────────────────────────────────

/**
 * Candidate API date strings for a kickoff. ESPN buckets matches by US date,
 * so the UTC date is primary and the SGT date (often +1 day) the fallback.
 * @param {string} kickoffSgt - ISO kickoff time
 * @param {string} [sep] - separator between date parts ('' or '-')
 * @returns {string[]}
 */
function candidateDates(kickoffSgt, sep = '') {
  const ko = new Date(kickoffSgt);
  const utcDate = ko.toISOString().slice(0, 10);
  const sgtDate = ko.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const dates = [...new Set([utcDate, sgtDate])];
  return dates.map((d) => (sep === '' ? d.replace(/-/g, '') : d));
}

// ─── LIVE DATA SOURCES ───────────────────────────────────────────────────────

/**
 * Fetch live match state from ESPN's public scoreboard (no key required).
 * @param {string} team1
 * @param {string} team2
 * @param {string} kickoffSgt - ISO kickoff time
 * @returns {Promise<object|null>}  { status, minute, period, score1, score2, source }
 */
async function fetchEspnLive(team1, team2, kickoffSgt) {
  try {
    for (const dateStr of candidateDates(kickoffSgt)) {
      const resp = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`,
        { timeout: 12000 }
      );
      if (!resp.ok) continue;
      const data = await resp.json();

      const event = (data.events || []).find((e) => {
        const comps = e.competitions?.[0]?.competitors || [];
        return comps.some((c) => espnNameMatches(c.team?.displayName || '', team1)) &&
               comps.some((c) => espnNameMatches(c.team?.displayName || '', team2));
      });
      if (!event) continue;

      const comp = event.competitions?.[0] || {};
      const statusType = comp.status?.type || {};
      const comps = comp.competitors || [];
      const c1 = comps.find((c) => espnNameMatches(c.team?.displayName || '', team1));
      const c2 = comps.find((c) => espnNameMatches(c.team?.displayName || '', team2));
      if (!c1 || !c2) continue;

      const stateMap = { pre: 'upcoming', in: 'live', post: 'finished' };
      let status = stateMap[statusType.state] || 'upcoming';
      if (statusType.name === 'STATUS_HALFTIME') status = 'halftime';

      // Red cards from the scoreboard play-by-play details
      const details = comp.details || [];
      const redFor = (competitor) => details.filter((d) => (
        d.redCard && String(d.team?.id || '') === String(competitor.team?.id || competitor.id || '')
      )).length;

      return {
        status,
        minute: comp.status?.displayClock || '',
        period: statusType.description || '',
        score1: parseInt(c1.score, 10) || 0,
        score2: parseInt(c2.score, 10) || 0,
        redCards1: redFor(c1),
        redCards2: redFor(c2),
        eventId: event.id,
        source: 'espn',
      };
    }
    return null;
  } catch (err) {
    console.error('[LIVE] fetchEspnLive error:', err.message);
    return null;
  }
}

/**
 * Fetch live match state from FIFA's official calendar API (no key required).
 * @param {string} team1
 * @param {string} team2
 * @param {string} kickoffSgt - ISO kickoff time
 * @returns {Promise<object|null>}
 */
async function fetchFifaLive(team1, team2, kickoffSgt) {
  try {
    for (const dateStr of candidateDates(kickoffSgt, '-')) {
      const resp = await fetch(
        `https://api.fifa.com/api/v3/calendar/matches?from=${dateStr}T00:00:00Z&to=${dateStr}T23:59:59Z&idCompetition=${FIFA_COMPETITION_ID}&language=en&count=500`,
        { timeout: 12000 }
      );
      if (!resp.ok) continue;
      const data = await resp.json();

      const looseMatch = (name, ours) => {
        const n = (name || '').toLowerCase();
        const o = ours.toLowerCase();
        return n === o || n.includes(o) || o.includes(n);
      };

      const m = (data.Results || []).find((r) => {
        const home = r.Home?.TeamName?.[0]?.Description || '';
        const away = r.Away?.TeamName?.[0]?.Description || '';
        return (looseMatch(home, team1) && looseMatch(away, team2)) ||
               (looseMatch(home, team2) && looseMatch(away, team1));
      });
      if (!m) continue;

      const isReversed = looseMatch(m.Home?.TeamName?.[0]?.Description || '', team2);
      const home = m.HomeTeamScore ?? 0;
      const away = m.AwayTeamScore ?? 0;

      const status = m.MatchStatus === FIFA_STATUS_FINISHED ? 'finished'
        : m.MatchStatus === FIFA_STATUS_LIVE ? 'live'
        : 'upcoming';

      return {
        status,
        minute: m.MatchTime || '',
        period: '',
        score1: isReversed ? away : home,
        score2: isReversed ? home : away,
        source: 'fifa',
      };
    }
    return null;
  } catch (err) {
    console.error('[LIVE] fetchFifaLive error:', err.message);
    return null;
  }
}

/**
 * Fetch live match state from Sofascore's public API (last resort — often 403).
 * @param {string} team1
 * @param {string} team2
 * @param {string} kickoffSgt - ISO kickoff time
 * @returns {Promise<object|null>}
 */
async function fetchSofascoreLive(team1, team2, kickoffSgt) {
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
    for (const dateStr of candidateDates(kickoffSgt, '-')) {
      const resp = await fetch(
        `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${dateStr}`,
        { timeout: 12000, headers }
      );
      if (!resp.ok) continue;
      const data = await resp.json();

      const event = (data.events || []).find((e) => {
        const home = e.homeTeam?.name || '';
        const away = e.awayTeam?.name || '';
        return (sofascoreNameMatches(home, team1) && sofascoreNameMatches(away, team2)) ||
               (sofascoreNameMatches(home, team2) && sofascoreNameMatches(away, team1));
      });
      if (!event) continue;

      const typeMap = { notstarted: 'upcoming', inprogress: 'live', finished: 'finished' };
      const description = event.status?.description || '';
      let status = typeMap[event.status?.type] || 'upcoming';
      if (/halftime/i.test(description)) status = 'halftime';

      const isReversed = sofascoreNameMatches(event.homeTeam?.name || '', team2);
      const home = event.homeScore?.current ?? 0;
      const away = event.awayScore?.current ?? 0;

      const elapsed = Math.floor((Date.now() - new Date(kickoffSgt).getTime()) / 60000);
      const minute = status === 'live' ? `~${Math.min(Math.max(elapsed, 1), 90)}'` : '';

      return {
        status,
        minute,
        period: description,
        score1: isReversed ? away : home,
        score2: isReversed ? home : away,
        source: 'sofascore',
      };
    }
    return null;
  } catch (err) {
    console.error('[LIVE] fetchSofascoreLive error:', err.message);
    return null;
  }
}

/**
 * Fetch live data with a 3-source waterfall: ESPN → FIFA → Sofascore.
 * @param {string} team1
 * @param {string} team2
 * @param {string} kickoffSgt
 * @returns {Promise<object|null>}
 */
async function fetchLiveData(team1, team2, kickoffSgt) {
  const espn = await fetchEspnLive(team1, team2, kickoffSgt);
  if (espn) return espn;
  const fifa = await fetchFifaLive(team1, team2, kickoffSgt);
  if (fifa) return fifa;
  return fetchSofascoreLive(team1, team2, kickoffSgt);
}

// ─── LIVE MATCH STATS (ESPN boxscore) ────────────────────────────────────────

/**
 * Fetch in-progress team stats from ESPN's summary endpoint (updates live).
 * Returns possession, shots, shots on target, corners, saves — or null.
 * @param {string} team1
 * @param {string} team2
 * @param {string} eventId - ESPN event ID from the scoreboard
 * @returns {Promise<object|null>}
 */
async function fetchEspnLiveStats(team1, team2, eventId) {
  try {
    const resp = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`,
      { timeout: 12000 }
    );
    if (!resp.ok) return null;
    const data = await resp.json();

    const boxTeams = data.boxscore?.teams || [];
    if (boxTeams.length < 2) return null;

    let st1 = null;
    let st2 = null;
    for (const bt of boxTeams) {
      const eName = bt.team?.displayName || '';
      if (espnNameMatches(eName, team1)) st1 = bt.statistics || [];
      else if (espnNameMatches(eName, team2)) st2 = bt.statistics || [];
    }
    if (!st1) st1 = boxTeams[0]?.statistics || [];
    if (!st2) st2 = boxTeams[1]?.statistics || [];

    return {
      possession1:    espnStat(st1, ['possessionPct', 'ballPossession', 'possession']),
      possession2:    espnStat(st2, ['possessionPct', 'ballPossession', 'possession']),
      shots1:         espnStat(st1, ['totalShots', 'shotsTotal', 'shots']),
      shots2:         espnStat(st2, ['totalShots', 'shotsTotal', 'shots']),
      shotsOnTarget1: espnStat(st1, ['shotsOnTarget', 'totalShotsOnGoal', 'onTargetAttempts']),
      shotsOnTarget2: espnStat(st2, ['shotsOnTarget', 'totalShotsOnGoal', 'onTargetAttempts']),
      corners1:       espnStat(st1, ['cornerKicks', 'corners']),
      corners2:       espnStat(st2, ['cornerKicks', 'corners']),
      saves1:         espnStat(st1, ['saves', 'goalKeeperSaves']),
      saves2:         espnStat(st2, ['saves', 'goalKeeperSaves']),
      source: 'espn',
    };
  } catch (err) {
    console.error('[LIVE] fetchEspnLiveStats error:', err.message);
    return null;
  }
}

/**
 * Get live stats for a match, refreshed at most every LIVE_REFRESH_MS.
 * Falls back to the last cached stats when ESPN is unavailable.
 * @param {object} fixture
 * @param {object} live - must contain eventId for a fresh fetch
 * @returns {Promise<object|null>}
 */
async function getLiveStats(fixture, live) {
  const { matchId } = fixture;
  const cached = liveStatsCache[matchId];
  const fresh = cached && Date.now() - cached.fetchedAt < LIVE_REFRESH_MS;
  if (fresh || !live.eventId) return cached?.stats || null;

  const stats = await fetchEspnLiveStats(fixture.team1, fixture.team2, live.eventId);
  if (stats) {
    liveStatsCache[matchId] = { stats, fetchedAt: Date.now() };
    return stats;
  }
  return cached?.stats || null;
}

// ─── TELEGRAM ALERTS ─────────────────────────────────────────────────────────

/**
 * Send a live-event alert once (deduped via sent-alerts store).
 * @param {string} alertKey
 * @param {string} message - MarkdownV2-escaped message
 */
async function sendLiveAlertOnce(alertKey, message) {
  if (isAlertSent(alertKey)) return;
  try {
    await sendToChannel(message);
    markAlertSent(alertKey);
    console.log(`[LIVE] Alert sent: ${alertKey}`);
  } catch (err) {
    console.error(`[LIVE] Alert error (${alertKey}):`, err.message);
  }
}

/**
 * Build a score line like "Mexico 1:0 South Africa" (escaped).
 * @param {object} fixture
 * @param {object} live
 * @returns {string}
 */
function scoreLine(fixture, live) {
  return `${escapeMd(fixture.team1)} ${live.score1}:${live.score2} ${escapeMd(fixture.team2)}`;
}

/**
 * Build the live win-probability lines for alerts (escaped).
 * @param {object} fixture
 * @param {object} outlook
 * @returns {string[]}
 */
function outlookLines(fixture, outlook) {
  return [
    escapeMd(`📈 ${fixture.team1} ${outlook.winProb1}% | Draw ${outlook.drawProb}% | ${fixture.team2} ${outlook.winProb2}%`),
    escapeMd(`🔮 Projected final: ${outlook.predictedFinal}`),
  ];
}

/**
 * Detect state transitions vs previous poll and fire Telegram alerts.
 * @param {object} fixture
 * @param {object|null} prev - previous live entry
 * @param {object} live - fresh live data
 * @param {object} outlook - live win-probability outlook
 * @returns {Promise<boolean>} true if a key event happened (kickoff/goal/HT)
 */
async function alertOnTransitions(fixture, prev, live, outlook) {
  const { matchId, team1, team2, group } = fixture;
  const zh = `${toZh(team1)} vs ${toZh(team2)}`;
  let keyEvent = false;

  if (live.status === 'live' && (!prev || prev.status === 'upcoming')) {
    keyEvent = true;
    await sendLiveAlertOnce(`kickoff-${matchId}`, [
      `🟢 *KICK\\-OFF \\| 开球*`,
      ``,
      `⚽ *${escapeMd(team1)} vs ${escapeMd(team2)}* \\(${escapeMd(zh)}\\)`,
      `📍 Group ${escapeMd(group)} \\| 🏟 ${escapeMd(fixture.venue || '')}`,
      ``,
      ...outlookLines(fixture, outlook),
      ``,
      `_Live score every minute, AI prediction refresh every 5 min \\| 比赛进行中_`,
    ].join('\n'));
  }

  const prevTotal = prev ? (prev.score1 || 0) + (prev.score2 || 0) : 0;
  const liveTotal = (live.score1 || 0) + (live.score2 || 0);
  if (prev && liveTotal > prevTotal) {
    keyEvent = true;
    await sendLiveAlertOnce(`goal-${matchId}-${live.score1}-${live.score2}`, [
      `⚽ *GOAL\\! \\| 进球\\!*`,
      ``,
      `*${scoreLine(fixture, live)}*`,
      `⏱ ${escapeMd(live.minute || live.period || '')}`,
      ``,
      ...outlookLines(fixture, outlook),
    ].join('\n'));
  }

  if (live.status === 'halftime' && prev && prev.status !== 'halftime') {
    keyEvent = true;
    await sendLiveAlertOnce(`halftime-${matchId}`, [
      `⏸ *HALF\\-TIME \\| 半场*`,
      ``,
      `*${scoreLine(fixture, live)}*`,
      ``,
      ...outlookLines(fixture, outlook),
    ].join('\n'));
  }

  return keyEvent;
}

// ─── OBSIDIAN LIVE NOTE ──────────────────────────────────────────────────────

/**
 * Write the live-now note to Obsidian so Qwen can answer live-score questions.
 * @param {object} matches - live store matches map
 */
async function writeLiveToObsidian(matches) {
  const now = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  const entries = Object.values(matches);

  const lines = [
    `# WC2026 Live Matches`,
    `<!-- last-updated: ${now} SGT -->`,
    ``,
    `*Qwen: use this file to answer questions about matches happening RIGHT NOW,*`,
    `*including the live score, match status, and updated in-match prediction.*`,
    ``,
  ];

  if (entries.length === 0) {
    lines.push(`*No matches live right now.*`);
  } else {
    for (const m of entries) {
      const icon = m.status === 'live' ? '🔴 LIVE' : m.status === 'halftime' ? '⏸ HT' : m.status === 'finished' ? '✅ FT' : '🕒 Starting soon';
      lines.push(`## ${icon} — ${m.team1} ${m.score1}:${m.score2} ${m.team2}`);
      lines.push(`- **Group:** ${m.group} | **Minute:** ${m.minute || '—'} ${m.period ? `(${m.period})` : ''}`);
      if (m.stats) {
        lines.push(`- **Live stats:** possession ${m.stats.possession1 ?? '?'}%–${m.stats.possession2 ?? '?'}% | shots ${m.stats.shots1 ?? '?'} (${m.stats.shotsOnTarget1 ?? '?'} on target)–${m.stats.shots2 ?? '?'} (${m.stats.shotsOnTarget2 ?? '?'}) | corners ${m.stats.corners1 ?? '?'}–${m.stats.corners2 ?? '?'}`);
      }
      if (m.redCards1 || m.redCards2) {
        lines.push(`- **Red cards:** ${m.team1} ${m.redCards1 || 0} | ${m.team2} ${m.redCards2 || 0}`);
      }
      if (m.outlook) {
        lines.push(`- **Live win probability:** ${m.team1} ${m.outlook.winProb1}% | Draw ${m.outlook.drawProb}% | ${m.team2} ${m.outlook.winProb2}%`);
        lines.push(`- **Projected final score:** ${m.outlook.predictedFinal} (favored: ${m.outlook.favored})`);
      }
      if (m.liveAnalysis) {
        lines.push(`- **Qwen in-match read (at ${m.liveAnalysis.atMinute}'):** ${m.liveAnalysis.winner} to win ${m.liveAnalysis.predicted_score} (${m.liveAnalysis.confidence}%) — ${m.liveAnalysis.analysis_summary}`);
      }
      lines.push(`- **Source:** ${m.source} | **Updated:** ${m.lastUpdated}`);
      lines.push(``);
    }
  }

  try {
    await fetch(`${OBSIDIAN_MCP}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'WC2026/live-now.md', content: lines.join('\n') }),
      timeout: 8000,
    });
  } catch (err) {
    console.error('[LIVE] Obsidian live-now write error:', err.message);
  }
}

// ─── MAIN POLL ───────────────────────────────────────────────────────────────

let polling = false;
const analysisInFlight = new Set();

/**
 * Trigger a detached Qwen in-match re-analysis. Result lands in
 * liveAnalysisCache and is merged into the store on the next poll.
 * @param {object} fixture
 * @param {object} live
 * @param {object} outlook
 * @param {object|null} stats - live ESPN match stats
 */
function triggerLiveAnalysis(fixture, live, outlook, stats) {
  const { matchId } = fixture;
  if (analysisInFlight.has(matchId)) return;
  analysisInFlight.add(matchId);
  lastAnalysisAt[matchId] = Date.now();

  refreshLiveAnalysis(fixture, live, outlook, stats)
    .then((analysis) => {
      if (analysis) liveAnalysisCache[matchId] = analysis;
    })
    .catch((err) => console.error(`[LIVE] triggerLiveAnalysis error (${matchId}):`, err.message))
    .finally(() => analysisInFlight.delete(matchId));
}

/**
 * Decide whether a Qwen re-analysis is due: always on a key event,
 * otherwise on the LIVE_REFRESH_MS cadence while the match is in play.
 * @param {string} matchId
 * @param {string} status
 * @param {boolean} keyEvent
 * @returns {boolean}
 */
function analysisDue(matchId, status, keyEvent) {
  if (status !== 'live' && status !== 'halftime') return false;
  if (keyEvent) return true;
  const last = lastAnalysisAt[matchId] || 0;
  return Date.now() - last >= LIVE_REFRESH_MS;
}

/**
 * Poll all matches currently in their live window and refresh the live store,
 * win probabilities, Qwen in-match prediction, Obsidian note, and Telegram
 * alerts. Safe to call every minute.
 * @param {object[]} fixtures
 * @returns {Promise<void>}
 */
async function pollLiveMatches(fixtures) {
  if (polling) return;
  polling = true;
  try {
    const now = Date.now();
    const windowMatches = fixtures.filter((f) => {
      const kickoff = new Date(f.dateIso).getTime();
      return now >= kickoff - PRE_KICKOFF_MS && now <= kickoff + POST_KICKOFF_MS;
    });

    const store = readLiveStore();

    if (windowMatches.length === 0) {
      // Clear the store and in-memory caches once everything has wrapped up
      if (Object.keys(store.matches).length > 0) {
        writeLiveStore({ matches: {}, lastUpdated: new Date().toISOString() });
        await writeLiveToObsidian({});
        for (const cache of [liveAnalysisCache, liveStatsCache, lastAnalysisAt]) {
          Object.keys(cache).forEach((k) => delete cache[k]);
        }
        console.log('[LIVE] No matches in window — live store cleared');
      }
      return;
    }

    let changed = false;
    for (const fixture of windowMatches) {
      const live = await fetchLiveData(fixture.team1, fixture.team2, fixture.dateIso);
      if (!live) continue;

      const prev = store.matches[fixture.matchId] || null;
      const preMatch = readPreMatchPrediction(fixture.matchId);

      const inPlay = live.status === 'live' || live.status === 'halftime';
      const stats = inPlay ? await getLiveStats(fixture, live) : null;
      const outlook = computeLiveOutlook(fixture, live, preMatch, stats);

      const keyEvent = await alertOnTransitions(fixture, prev, live, outlook);
      if (analysisDue(fixture.matchId, live.status, keyEvent)) {
        triggerLiveAnalysis(fixture, live, outlook, stats);
      }

      store.matches[fixture.matchId] = {
        matchId: fixture.matchId,
        team1: fixture.team1,
        team2: fixture.team2,
        group: fixture.group,
        venue: fixture.venue,
        ...live,
        stats,
        outlook,
        liveAnalysis: liveAnalysisCache[fixture.matchId] || prev?.liveAnalysis || null,
        lastUpdated: new Date().toISOString(),
      };
      changed = true;
      console.log(`[LIVE] ${fixture.team1} ${live.score1}:${live.score2} ${fixture.team2} — ${live.status} ${live.minute || ''} | ${fixture.team1} ${outlook.winProb1}%/D ${outlook.drawProb}%/${fixture.team2} ${outlook.winProb2}% (${live.source})`);
    }

    if (changed) {
      store.lastUpdated = new Date().toISOString();
      writeLiveStore(store);
      await writeLiveToObsidian(store.matches);
    }
  } catch (err) {
    console.error('[LIVE] pollLiveMatches error:', err.message);
  } finally {
    polling = false;
  }
}

module.exports = {
  readLiveStore,
  fetchEspnLive,
  fetchEspnLiveStats,
  fetchFifaLive,
  fetchSofascoreLive,
  fetchLiveData,
  pollLiveMatches,
  writeLiveToObsidian,
};
