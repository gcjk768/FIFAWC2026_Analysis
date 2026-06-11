# WC2026 Enterprise Multi-Agent Prediction System
## Architecture Plan — Maximum Accuracy Edition

---

## The Problem With the Current System

Right now you have one pipeline:

```
Obsidian notes → single qwen call → save → Telegram
```

One model, one pass, no validation, static stats hardcoded in server.js. This is fine for v1, but a single-shot LLM prediction is essentially a well-dressed coin flip dressed up as analysis. Here's why:

- **Static TEAM_STATS** — rank, form, goals are hardcoded. They don't update as the tournament progresses.
- **No cross-validation** — if Qwen hallucinates a confident prediction, nobody catches it.
- **Context dumping** — all Obsidian notes are injected as one blob. Qwen reads them equally, even irrelevant parts.
- **No calibration** — you never feedback how accurate past predictions were to adjust future ones.
- **Single dimension** — tactical + statistical + psychological + historical all collapsed into one prompt.

---

## The Enterprise Architecture: 8 Specialized Agents

Think of this like a proper football club analytics team. Each agent has ONE job. They report up to a Consensus Agent that makes the final call.

```
                        ┌─────────────────────────────┐
                        │      ORCHESTRATOR AGENT      │
                        │  (server.js /api/analyze)    │
                        └──────────────┬──────────────┘
                                       │ spawns
          ┌────────────┬───────────────┼────────────────┬──────────────┐
          ▼            ▼               ▼                ▼              ▼
   ┌─────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌────────────┐
   │  SCOUT      │ │TACTICAL  │ │STATISTICAL   │ │HISTORIAN │ │PSYCHOLOGIST│
   │  AGENT      │ │ANALYST   │ │MODELLER      │ │AGENT     │ │AGENT       │
   │(data fetch) │ │AGENT     │ │AGENT         │ │(H2H)     │ │(motivation)│
   └──────┬──────┘ └────┬─────┘ └──────┬───────┘ └────┬─────┘ └─────┬──────┘
          │             │               │               │              │
          └─────────────┴───────────────┴───────────────┴──────────────┘
                                        │ all results
                                        ▼
                            ┌───────────────────────┐
                            │   DEVIL'S ADVOCATE    │
                            │   AGENT (challenger)  │
                            └───────────┬───────────┘
                                        │
                                        ▼
                            ┌───────────────────────┐
                            │   CONSENSUS AGENT     │
                            │  (final prediction)   │
                            └───────────┬───────────┘
                                        │
                            ┌───────────┴───────────┐
                            ▼                       ▼
                     ┌─────────────┐       ┌────────────────┐
                     │ CALIBRATION │       │  BROADCAST     │
                     │ AGENT       │       │  AGENT         │
                     └─────────────┘       └────────────────┘
```

---

## Agent 1: Scout Agent
**File:** `services/agents/scoutAgent.js`
**Job:** Keep all data fresh. No stale hardcoded stats.

### What it does
- Fetches latest FIFA rankings from football-data.org (weekly refresh)
- Fetches actual results of WC2026 matches already played and updates TEAM_STATS dynamically
- Pulls tournament form: goals scored/conceded IN the tournament (not just pre-tournament)
- Reads `vault/WC2026/squad-news.md` and `vault/WC2026/injuries.md` for injury updates
- Returns a structured `TeamProfile` object for both teams

### Output format
```json
{
  "team": "Argentina",
  "rank": 1,
  "tournamentForm": { "played": 1, "goalsFor": 2, "goalsAgainst": 0, "result": "W" },
  "preForm": "WWWWW",
  "keyAbsences": ["De Jong (hamstring)"],
  "squadDepth": "world-class",
  "freshness": "2026-06-12T14:00:00Z"
}
```

### Why this matters
Your current TEAM_STATS are pre-tournament estimates. By Match 2, a team's tournament form matters MORE than their historical form. Spain conceding 2 in game 1 completely changes their defensive rating for game 2.

---

## Agent 2: Tactical Analyst Agent
**File:** `services/agents/tacticalAgent.js`
**Job:** Pure tactical matchup analysis. Formation vs formation, style vs style.

### Prompt focus
```
TASK: Tactical matchup only. No scores. No predictions yet.

Analyze HOW these teams play and WHERE the tactical battle will be decided.

Team1 shape + strengths + weaknesses
Team2 shape + strengths + weaknesses

Output:
- Key tactical battle (e.g. "Spain's positional play vs England's counter-press")
- Which team has the positional advantage in midfield
- Set-piece advantage (who's better at attacking/defending them)
- Which team's style favors HIGH-SCORING or LOW-SCORING match
- Pace of game prediction: "open", "cagey", "one-sided"
```

### Output
```json
{
  "keyBattle": "Spain's possession vs England's press",
  "midfield": "Spain",
  "setPieceThreat": "England",
  "scoringEnvironment": "low",
  "gamePace": "cagey",
  "tacticalEdge": "Spain"
}
```

---

## Agent 3: Statistical Modeller Agent
**File:** `services/agents/statisticalAgent.js`
**Job:** Pure numbers. No narrative. Expected goals calculation.

### What it computes
Uses the **Dixon-Coles simplified model** (standard football prediction math):

```
Expected Goals Team1 = (team1.goalsFor × team2.goalsAgainst) / leagueAverage
Expected Goals Team2 = (team2.goalsFor × team1.goalsAgainst) / leagueAverage
```

Then simulates the scoreline distribution (Poisson) to estimate:
- Win probability Team1
- Win probability Team2
- Draw probability
- Most likely exact scores (top 5)

This is pure code, not an LLM call. Fast, deterministic, no hallucination.

### Output
```json
{
  "xG1": 1.8,
  "xG2": 0.9,
  "winProb1": 0.58,
  "winProb2": 0.22,
  "drawProb": 0.20,
  "topScores": ["1-0", "2-0", "2-1", "1-1", "0-0"],
  "predictedScore": "2-1"
}
```

---

## Agent 4: Historian Agent
**File:** `services/agents/historianAgent.js`
**Job:** What does history say about this exact matchup?

### Qwen prompt focus
```
TASK: H2H historical analysis only.

Given these H2H records between Team1 and Team2:
[h2h content from vault]

Analyze:
1. Who has the psychological H2H edge?
2. Does recent form matter more than long-term H2H? (yes — weight last 5 years)
3. Any tournament-specific pattern? (some teams overperform in WC vs friendlies)
4. Is the current matchup a repeat of a memorable recent meeting?

Output verdict: "favors_team1" | "favors_team2" | "neutral"
```

### Output
```json
{
  "h2hVerdict": "favors_team2",
  "keyMeeting": "2022 WC: Morocco beat Spain on penalties",
  "psychEdge": "Morocco",
  "h2hWeight": 0.7
}
```

---

## Agent 5: Psychologist Agent
**File:** `services/agents/psychologistAgent.js`
**Job:** Motivation, pressure, narrative. The "human" factors.

### Inputs it reads
- Current group standings (from `vault/WC2026/live-standings.md`)
- Does either team NEED to win to qualify?
- Is one team already through and "rotating"?
- Venue effect (USA teams playing in US = home crowd pressure)
- Is this a "revenge match" (e.g. Spain vs Morocco after 2022 penalty shootout)?
- Star player milestone pressure (Messi's last WC, Ronaldo's last WC)

### Qwen prompt
```
TASK: Psychological and motivational analysis only.

Given the group stage standings below, answer:
1. What does each team NEED from this match? (must-win / draw OK / already qualified)
2. Is there mental baggage from a famous recent defeat?
3. Tournament fatigue? (3rd group stage game = fresher legs matter)
4. Crowd/venue impact?
5. Overall motivational edge: Team1 or Team2?
```

### Output
```json
{
  "team1Motivation": "must-win",
  "team2Motivation": "draw-ok",
  "motivationalEdge": "team1",
  "psychFactors": ["Morocco revenge narrative", "Spain rotate if through"],
  "impactScore": 0.6
}
```

---

## Agent 6: Devil's Advocate Agent
**File:** `services/agents/devilsAdvocateAgent.js`
**Job:** Challenge the emerging consensus. Force the system to consider upsets.

This agent receives the DRAFT consensus from Agents 1-5 and tries to BREAK it.

### Qwen prompt
```
TASK: You are a contrarian analyst. The current prediction favors [TEAM] with [X]% confidence.

Your job: find the STRONGEST case for why the other team wins.

Consider:
- When have big favorites lost at this WC stage?
- Is the favorite likely to be complacent / rotate players?
- Does the underdog have ONE specific weapon that could decide the match?
- Is the statistical model missing something qualitative?

Output: upset_probability (0-100), upset_scenario, key_risk
```

### Output
```json
{
  "upsetProbability": 22,
  "upsetScenario": "Ecuador exploit Spain's high defensive line with pace",
  "keyRisk": "Spain rotate 3 starters; Ecuador motivated must-win",
  "recommendAdjustment": true,
  "adjustedConfidence": 68
}
```

---

## Agent 7: Consensus Agent
**File:** `services/agents/consensusAgent.js`
**Job:** Aggregate all agent outputs into ONE prediction with calibrated confidence.

### Weighting system
```js
const WEIGHTS = {
  statistical:    0.30,  // pure math, most objective
  tactical:       0.25,  // formation advantage matters
  psychologist:   0.20,  // motivation huge in group stage
  historian:      0.15,  // H2H has real signal
  devilsAdvocate: 0.10,  // upset adjustment
};
```

### What this agent does
1. Receives JSON outputs from all 5 specialist agents
2. Runs ONE final Qwen call with ALL the mini-reports as context
3. Prompt instructs Qwen to act as a **Head Analyst synthesizing a committee briefing**
4. Produces the final prediction JSON that matches your existing schema

### Prompt
```
You are the Head Analyst at a professional football intelligence firm.

Your team of specialists has filed the following reports:

[TACTICAL REPORT]: ...
[STATISTICAL MODEL]: xG: 1.8 vs 0.9 | win prob: 58% vs 22% | draw: 20%
[H2H HISTORY]: ...
[PSYCHOLOGICAL FACTORS]: ...
[DEVIL'S ADVOCATE]: upset_probability: 22%

Your job: produce a FINAL verdict that synthesizes all inputs.
Do NOT ignore any report. If they conflict, explain why you sided with one over another.
Use the statistical model as your baseline, adjust up/down based on qualitative factors.

Output ONLY valid JSON:
{"winner":"...","confidence":75,"predicted_score":"2-1","score_reasoning":"...","key_factors":[...],"analysis_summary":"...","risk_factor":"low|medium|high"}
```

---

## Agent 8: Calibration Agent
**File:** `services/agents/calibrationAgent.js`
**Job:** Track accuracy. Feed back to improve future confidence scores.

### What it tracks
After real results come in (via `resultsService.js`), compute:
- **Outcome accuracy** — did we predict the right winner?
- **Confidence calibration** — when we say 80% confidence, do we win 80% of those?
- **Score proximity** — average goal difference between predicted and actual
- **Per-team bias** — are we systematically overrating certain teams?

### Weekly calibration report
Writes to `vault/WC2026/calibration-report.md`:
```markdown
## Calibration Report — Group Stage (Matchday 1)
- Matches predicted: 12
- Outcome correct: 8/12 (66.7%)
- Avg confidence on correct picks: 72%
- Avg confidence on wrong picks: 64%
- Most overrated: Saudi Arabia (predicted W, got LL)
- Score RMSE: 1.2 goals
```

This report gets injected back into the Scout Agent context, so Qwen knows "we tend to underrate African teams in group stage."

---

## Improved Master Prompt (for Consensus Agent)

Replace the current single-prompt approach with this as the FINAL synthesis prompt:

```js
const buildConsensusPrompt = (team1, team2, group, stage, reports) => `/no_think
You are the Head of Match Intelligence at a FIFA-certified football analytics firm.

MATCH: ${team1} vs ${team2} | Group ${group} | ${stage}

═══════════════════════════════════════════
SPECIALIST BRIEFINGS (synthesize all of them)
═══════════════════════════════════════════

📊 STATISTICAL MODEL:
xG: ${reports.stats.xG1} vs ${reports.stats.xG2}
Win probabilities: ${team1} ${(reports.stats.winProb1*100).toFixed(0)}% | Draw ${(reports.stats.drawProb*100).toFixed(0)}% | ${team2} ${(reports.stats.winProb2*100).toFixed(0)}%
Most likely scores: ${reports.stats.topScores.join(', ')}

⚽ TACTICAL ANALYST:
${reports.tactical.keyBattle}
Midfield control: ${reports.tactical.midfield}
Game pace: ${reports.tactical.gamePace}
Tactical edge: ${reports.tactical.tacticalEdge}

📖 HISTORICAL ANALYST (H2H):
${reports.historian.keyMeeting}
H2H verdict: ${reports.historian.h2hVerdict}
Psychological edge: ${reports.historian.psychEdge}

🧠 PSYCHOLOGICAL ANALYST:
${team1} motivation: ${reports.psych.team1Motivation}
${team2} motivation: ${reports.psych.team2Motivation}
Key psych factors: ${reports.psych.psychFactors.join(', ')}

⚠️ DEVIL'S ADVOCATE:
Upset probability: ${reports.devil.upsetProbability}%
Upset scenario: ${reports.devil.upsetScenario}
Key risk: ${reports.devil.keyRisk}

🌡️ CONTEXT:
Weather: ${reports.weather || 'N/A'}
${reports.calibration ? `Calibration note: ${reports.calibration}` : ''}
${reports.squadNews ? `Squad news: ${reports.squadNews}` : ''}

═══════════════════════════════════════════
INSTRUCTIONS:
1. Use the statistical model as your BASELINE — do not stray more than 15% from it without strong qualitative reason
2. Upgrade confidence if 3+ agents agree strongly
3. Downgrade confidence if devil's advocate scenario is plausible (>25% upset probability)
4. Score MUST reflect the tactical game pace (cagey games → 1-0, 0-0 more likely)
5. Group stage: draws are completely valid — do not force a winner
6. Confidence 50=coin flip, 95=near certainty; be honest, not optimistic

Respond ONLY with valid JSON:
{"winner":"${team1}|${team2}|draw","confidence":75,"predicted_score":"2-1","score_reasoning":"why each team scores that number","key_factors":["factor1","factor2","factor3"],"analysis_summary":"3-sentence tactical breakdown mentioning specific players.","risk_factor":"low|medium|high","agent_votes":{"statistical":"team1","tactical":"team1","historian":"draw","psychological":"team1","devil_upset_pct":22}}
`;
```

---

## Implementation Roadmap

### Phase 1 — Data freshness (do this first, biggest ROI)
1. Move TEAM_STATS out of server.js into `data/team-stats.json`
2. Build `scoutAgent.js` to auto-update stats after each real result
3. Add `tournamentGoalsFor`/`tournamentGoalsAgainst` to TEAM_STATS that update live

### Phase 2 — Statistical model (no LLM, pure code)
1. Implement Poisson xG calculator in `statisticalAgent.js`
2. Run it as a fast pre-step before any Qwen calls
3. Use its output to anchor confidence range

### Phase 3 — Specialized Qwen prompts (3 separate calls instead of 1)
1. Split into: `tacticalAgent.js` + `historianAgent.js` + `psychologistAgent.js`
2. Run all 3 in parallel (`Promise.all`)
3. Devil's advocate runs after, seeing the 3 reports

### Phase 4 — Consensus synthesis
1. Build `consensusAgent.js` with the improved master prompt above
2. Feed all specialist outputs into it
3. Update the analyze pipeline in server.js

### Phase 5 — Calibration loop
1. Build `calibrationAgent.js` that compares predictions vs real results
2. Write weekly calibration report to Obsidian vault
3. Inject calibration notes into future consensus prompts

---

## API Changes Needed

```
POST /api/analyze/:matchId
  → new query param: ?mode=full (5-agent) | ?mode=fast (current single call, default)

GET /api/analyze/status/:matchId
  → returns agent pipeline progress (useful for UI spinner)

GET /api/calibration
  → returns accuracy stats and per-team bias report
```

---

## File Structure

```
services/
  agents/
    orchestratorAgent.js    ← replaces the inline pipeline in server.js
    scoutAgent.js           ← data freshness
    statisticalAgent.js     ← Poisson xG calculator (no LLM)
    tacticalAgent.js        ← tactical matchup (Qwen call #1)
    historianAgent.js       ← H2H analysis (Qwen call #2)
    psychologistAgent.js    ← motivation/pressure (Qwen call #3)
    devilsAdvocateAgent.js  ← upset challenger (Qwen call #4)
    consensusAgent.js       ← final synthesis (Qwen call #5)
    calibrationAgent.js     ← accuracy tracking (post-result)
```

---

## Expected Accuracy Improvement

| Approach | Expected Outcome Accuracy |
|----------|--------------------------|
| Current (single Qwen call) | ~55-62% |
| + Live stats (Scout Agent) | ~60-65% |
| + Statistical model anchor | ~63-68% |
| + 3 specialist agents | ~65-70% |
| + Devil's advocate + calibration | ~68-74% |

Note: 74% is approaching the accuracy of professional football prediction models. Anything above 70% is genuinely strong for football (a notoriously low-information sport).

---

## Quick Win: Improved Single Prompt (Before Full Multi-Agent)

If you want ONE change that immediately improves the current prompt before building the full system, replace the current `buildOllamaPrompt` with this:

```js
function buildOllamaPrompt(team1, team2, group, s1, s2, obsidianContext = '') {
  // Pre-calculate xG anchor
  const leagueAvg = 1.35;
  const xG1 = ((s1.goalsFor * s2.goalsAgainst) / leagueAvg).toFixed(2);
  const xG2 = ((s2.goalsFor * s1.goalsAgainst) / leagueAvg).toFixed(2);
  const rankGap = Math.abs(s1.rank - s2.rank);
  const favorite = s1.rank < s2.rank ? team1 : team2;

  return `/no_think
You are a professional football analyst. Think step by step, then output JSON.

═══ MATCH ═══
${team1} vs ${team2} | Group ${group} | Group Stage (draws valid)

═══ TEAM DATA ═══
${team1}: FIFA #${s1.rank} | Goals F/A per game: ${s1.goalsFor}/${s1.goalsAgainst} | Form: ${s1.form}
${team2}: FIFA #${s2.rank} | Goals F/A per game: ${s2.goalsFor}/${s2.goalsAgainst} | Form: ${s2.form}

═══ STATISTICAL ANCHOR (use this as your baseline) ═══
Expected Goals: ${team1} ${xG1} xG vs ${team2} ${xG2} xG
Ranking gap: ${rankGap} places — ${favorite} is the statistical favourite
Note: a team scoring 2.0 xG vs a team conceding 0.7/game = attacking team likely scores 1-2 goals

═══ INTELLIGENCE NOTES ═══
${obsidianContext || 'No additional context available.'}

═══ ANALYSIS STEPS (reason through each) ═══
STEP 1 — STATISTICAL: Is the xG anchor reasonable? What adjustments?
STEP 2 — TACTICAL: What is the KEY tactical battle that decides this match?
STEP 3 — CONTEXT: Any injury/motivation/venue factor that changes the picture?
STEP 4 — SCORE: What is the most REALISTIC score (not just a 1-0 default)?
STEP 5 — RISK: What is the realistic upset scenario?

Then output ONLY this JSON (no markdown, no preamble):
{"winner":"${team1}|${team2}|draw","confidence":75,"predicted_score":"2-1","score_reasoning":"why team1 scores X: [reason]. why team2 scores Y: [reason].","key_factors":["factor1","factor2","factor3"],"analysis_summary":"3 sentences, mention specific players and tactical reasons.","risk_factor":"low|medium|high"}`;
}
```

This single change (adding the xG anchor + step-by-step reasoning) will meaningfully improve score prediction accuracy because Qwen now has a mathematical baseline to reason against instead of generating scores intuitively.
