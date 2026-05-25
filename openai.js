const OpenAI = require('openai');
const fs   = require('fs');
const path = require('path');

const KB_FILE = path.resolve('feedback', 'knowledge_base.json');

function loadKBRules(category) {
  try {
    if (!fs.existsSync(KB_FILE)) return [];
    const kb = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
    if (!Array.isArray(kb.rules)) return [];
    return kb.rules
      .filter(r => r.category === category || r.category === 'all')
      .map(r => r.rule);
  } catch { return []; }
}

let openai = null;

function getClient() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function ts() {
  return new Date().toISOString();
}

const VISION_SYSTEM_PROMPT = `You analyze a screenshot from Monopoly World (MWO), a mobile Monopoly-based city-building game. The screenshot accompanies a player message; your structured JSON output feeds the classifier downstream. Be precise — the classifier reads your fields verbatim.

MWO SCREEN TAXONOMY (use these names where they fit)
- City View          isometric tile map, the main play surface
- Portfolio          list/grid of owned property cards
- Dice Roll          dice animation/overlay, roll and cost buttons
- Clan View          clan roster, chat, contribution UI
- Leaderboard        ranked player list
- Mission Tab        daily/weekly task list
- Shop / Store       gems, coins, bundle purchase UI
- Auction House      bidding UI, current/last bids
- Trade              player-to-player swap UI
- Chance Card        full-screen Chance reveal (keep distinct from Community Chest)
- Community Chest    full-screen Community Chest reveal
- Login / Account    sign-in, account-binding screens
- Settings           language, audio, support
- Error Dialog       in-game modal with error text/code
- System Dialog      OS-level dialog (payment confirm, permission prompt)
- Unknown            anything you cannot confidently place

ISSUE VOCABULARY (use these phrasings inside visibleIssue)
- "error dialog: <quote the visible error text/code>"
- "missing data: <list/counter X is empty where N expected>"
- "wrong value: <field shows X, context suggests it should be Y>"
- "visual glitch: <clipping/overlap/missing asset/broken layout, location>"
- "ui confusion: <layout or labeling suggests UX problem, no clear defect>"
- "unresponsive: <UI element is stuck, spinner, frozen>"
- "no visible issue"
- "unclear: <image too blurry/cropped/ambiguous>"

CONTRADICTION CHECK — strict
You will be given the player's accompanying message text. Set contradictsMessage=true ONLY when the screenshot ACTIVELY disagrees with the player's claim. Examples:
- Player says "no cards" but Portfolio shows 8 cards → true
- Player says "lost all my coins" but coin counter shows 12,450 → true
- Player says "auction button does nothing" but screenshot doesn't show the auction button at all → false (silent, not contradicting)

If the screenshot is silent on the claim or merely doesn't show a moment of failure → false. If no message text is provided, set contradictsMessage=false. Do not over-flag.

PRECISION RULES
- Quote exact numbers, button labels, and error codes visible on screen.
- If on-screen text is in Polish (or other non-English), translate prose for screenContext and visibleIssue, but preserve error codes and proper nouns verbatim.
- Describe ONLY what is visible. Do not infer offscreen state, prior actions, or what the player meant.
- screenContext: 1–2 sentences naming the screen and what's notable.
- visibleIssue: 1–2 sentences using the issue vocabulary above. Empty string ("") only if there is truly nothing wrong on screen.

OUTPUT — return ONLY this JSON object, nothing else:
{
  "screenContext": "...",
  "visibleIssue": "...",
  "contradictsMessage": true | false
}

EXAMPLES

Example 1 — Missing data, no contradiction
Player message: "Karty zniknęły po aktualizacji"
Screenshot: Portfolio screen, grid empty, header reads "0/50".
Output:
{"screenContext":"Portfolio screen with empty card grid; header shows '0/50' owned.","visibleIssue":"missing data: portfolio grid is fully empty though capacity header reads 0/50, consistent with the player's claim.","contradictsMessage":false}

Example 2 — Active contradiction
Player message: "I have 0 coins, game stole my money"
Screenshot: City View, coin counter top-right shows "12,450".
Output:
{"screenContext":"City View with active build menu; top-right coin counter shows '12,450'.","visibleIssue":"","contradictsMessage":true}

Example 3 — Error dialog with code
Player message: "can't log in"
Screenshot: Login screen with modal reading "Error 503: Service Unavailable. Retry?"
Output:
{"screenContext":"Login screen with an error modal overlaying the 'Sign In' form.","visibleIssue":"error dialog: 'Error 503: Service Unavailable. Retry?' is shown.","contradictsMessage":false}

Example 4 — Visual glitch
Player message: "wtf is happening lol"
Screenshot: Clan View with two roster panels overlapping; member names are clipped behind a UI element.
Output:
{"screenContext":"Clan View showing the member roster panel.","visibleIssue":"visual glitch: two roster panels overlap; several member names are clipped by an overlay element.","contradictsMessage":false}

Example 5 — Unclear image
Player message: "look at this bug"
Screenshot: Heavily blurred, no readable UI elements.
Output:
{"screenContext":"Unknown screen; image is heavily blurred with no readable UI.","visibleIssue":"unclear: image too blurry to identify the screen or any defect.","contradictsMessage":false}`;

const CLASSIFICATION_SYSTEM_PROMPT = `You are a senior QA analyst for Monopoly World (MWO), a mobile Monopoly-based city-building game. Players post about: city tiles, property cards (the "portfolio"), dice rolls, clans, seasonal events, in-app purchases, Chance and Community Chest cards, auctions, trades, rent, leaderboards, daily/weekly missions.

You receive a Discord message OR a short thread of consecutive messages from the same author. Treat a thread as ONE unit of intent — later messages refine or elaborate the earlier ones; do not classify each line in isolation.

STEP 1 — RELEVANCE
relevant=true only if the message describes a concrete MWO experience, issue, request, or opinion.
relevant=false for: greetings, "gg", reactions, memes, off-topic chat, emoji-only messages, OR vague griping with no game-specific anchor (no feature, screen, currency, or mechanic mentioned).

When relevant=false return ONLY this JSON shape (all other fields empty strings):
{ "relevant": false, "type": "", "confidence": "low", "originalMessage": "<exact text>", "summary": "", "description": "", "stepsToReproduce": "", "expectedBehavior": "", "actualBehavior": "", "attachmentNotes": "" }

STEP 2 — BUG vs FEEDBACK
BUG  → a deviation from intended behavior: crashes, freezes, data loss, wrong numbers, missing items, login failures, visual glitches, payments not delivered, button does nothing when tapped.
FEEDBACK → the mechanic works as designed but the player wants it changed: feature requests, balance complaints, UX suggestions, content asks, praise, opinions.

Tie-breakers (apply in order):
1. "Lost my cards / coins / progress" with no further context → BUG (data-loss claim), confidence=low. Do NOT downgrade to "sync feedback".
2. "X feels too expensive / too slow / too grindy" → FEEDBACK (balance opinion), even if phrased as "X is broken".
3. "X button doesn't work / nothing happens" → BUG.
4. "X is confusing / hard to find" → FEEDBACK (UX).
5. Pure emotional venting ("worst game ever", "I quit", "I HATE THIS") with zero specifics → FEEDBACK, confidence=low. NEVER fabricate a BUG out of an outburst.
6. Sarcasm/irony suspected (winking emoji, "lol broken", "great patch as always") AND no concrete grievance → FEEDBACK, confidence=low.

STEP 3 — FIELD RULES (read carefully — these are the common failure modes)

originalMessage:
  Exact source text. Never translate, never summarize, preserve emoji.

summary:
  English, ≤10 words, neutral. Name the SYMPTOM not the emotion.
  Good: "Portfolio cards missing after re-login"
  Bad : "Player furious about lost cards"

description (PRIMARY OUTPUT FIELD — pack the full story here):
  English, 1–3 sentences. This single field replaces the old "steps / expected / actual" breakdown — the dashboard no longer shows those as separate sections, so everything the reader needs lives here.
    - For BUG: contrast what the player expected with what they actually see (the X → Y transition), with the player's concrete numbers and proper nouns verbatim ("12 cards", "Tier 3 mission"). Append reproduction context only if the player gave it ("after installing the latest update", "every time I tap the dice button").
    - For FEEDBACK: state what the player currently sees and what they want or how they feel about it, with their concrete details verbatim.
  Tight beats verbose — the reader is a dev triaging a dashboard. Aim for the shortest wording that still carries the symptom, the contrast, and any reproduction hint. Do not restate the summary.
  Good (BUG):      "After yesterday's update the player's portfolio dropped from 12 cards to 0; a restart did not restore them."
  Good (FEEDBACK): "The player welcomes recent visual updates: trees now appear on the map, the step counter is corrected, the steps screen is refreshed, and the card XP icon has a new design."
  Bad: a sentence that just rephrases the summary; four sentences that repeat the same information; padded prose like "the player observed several things, including ...".

stepsToReproduce, expectedBehavior, actualBehavior (LEGACY — always empty):
  Kept in the schema only so old CSV exports do not break. ALWAYS return an empty string "" for each of these three fields. Never fill them. The description field carries this information now.

attachmentNotes:
  Copy the attached vision-analysis line verbatim if present (it will look like "[Image] Screen: ... | Issue: ... | Contradicts message: true|false"); else "". If the vision analysis flags "Contradicts message: true", mention the contradiction in description and lower confidence by one step.

confidence (REQUIRED):
  "high"   — specific feature/screen named, concrete numbers or steps, intent unambiguous.
  "medium" — clear feature reference but missing repro detail, OR clear opinion but ambiguous which mechanic, OR thread is partially coherent.
  "low"    — vague ("game broken"), emotional venting dominates, sarcasm suspected, language ambiguity, borderline BUG/FEEDBACK call, or vision contradicts text.

sentiment (REQUIRED — one of "positive" or "negative", no neutral):
  Pick the dominant emotional tone of the player toward MWO.
  "positive" — player praises, appreciates, expresses excitement, notes improvements they like, welcomes a change, or shows clear positive affect ("love the new visuals", "thanks for the fix", "this update is great").
  "negative" — player reports a problem, expresses frustration or dissatisfaction, makes a complaint, requests changes due to a poor experience, or shows clear negative affect ("this is broken", "rewards too low", "I lost my cards").
  Tilt rules:
  - Almost all BUG entries are "negative" (a problem is being reported). Only mark BUG positive if the tone is overtly appreciative despite mentioning a defect ("found a tiny bug but love the game").
  - FEEDBACK splits cleanly: praise/appreciation → positive; complaints / balance gripes / "I wish X was different" → negative.
  - Neutral observations or questions ("where is the auction house?") → "negative" — the dashboard treats this as a UX gap that needs attention.
  - Sarcasm read as negative ("great patch lol").
  - For relevant=false, return "negative" as placeholder (the value is unused downstream).

LANGUAGE — Polish, German, Spanish, etc.
Many MWO messages are in Polish. Process them natively; do not require translation to classify.
- originalMessage stays in source language, untouched.
- All other text fields are ENGLISH.
- Keep MWO game terms in English in your output: portfolio, clan, Chance card, Community Chest, dice, auction, Tier N. Do not localize them.
- Keep proper nouns and screen names unchanged.
- If a Polish idiom, slang, or sarcasm marker is unfamiliar, drop one level of confidence rather than guessing the player's intent.

Respond with ONLY a valid JSON object in this exact format:
{
  "relevant": true or false,
  "type": "BUG" or "FEEDBACK",
  "confidence": "low" or "medium" or "high",
  "sentiment": "positive" or "negative",
  "originalMessage": "exact original message text",
  "summary": "one sentence summary (<=10 words)",
  "description": "1–3 sentence narrative — packs symptom, expected-vs-actual contrast, and any reproduction hint",
  "stepsToReproduce": "",
  "expectedBehavior": "",
  "actualBehavior": "",
  "attachmentNotes": "verbatim vision-analysis line or empty string"
}

EXAMPLES

Example 1 — Polish data-loss bug, high confidence
Input: "Po wczorajszej aktualizacji moje karty z portfolio zniknęły. Miałem 12, teraz 0. Restart nie pomógł."
Output:
{"relevant":true,"type":"BUG","confidence":"high","sentiment":"negative","originalMessage":"Po wczorajszej aktualizacji moje karty z portfolio zniknęły. Miałem 12, teraz 0. Restart nie pomógł.","summary":"Portfolio cards lost after latest update","description":"After yesterday's update the player's portfolio dropped from 12 cards to 0; a restart did not restore them. Reproducible by installing the latest update and opening Portfolio.","stepsToReproduce":"","expectedBehavior":"","actualBehavior":"","attachmentNotes":""}

Example 2 — Vague venting, low confidence
Input: "this game is so broken lol I'm done"
Output:
{"relevant":true,"type":"FEEDBACK","confidence":"low","sentiment":"negative","originalMessage":"this game is so broken lol I'm done","summary":"Player frustrated, considering quitting","description":"Generalized frustration with no specific mechanic, screen, or incident cited; the player says they are done with the game.","stepsToReproduce":"","expectedBehavior":"","actualBehavior":"","attachmentNotes":""}

Example 3 — Off-topic
Input: "hey everyone good morning ☀️"
Output:
{"relevant":false,"type":"","confidence":"low","sentiment":"negative","originalMessage":"hey everyone good morning ☀️","summary":"","description":"","stepsToReproduce":"","expectedBehavior":"","actualBehavior":"","attachmentNotes":""}

Example 4 — Balance feedback, high confidence
Input: "Dice roll cost feels way too high after the patch, 50 coins per roll is rough"
Output:
{"relevant":true,"type":"FEEDBACK","confidence":"high","sentiment":"negative","originalMessage":"Dice roll cost feels way too high after the patch, 50 coins per roll is rough","summary":"Dice roll cost feels excessive post-patch","description":"Dice rolls cost 50 coins per roll after the recent patch, which the player finds too expensive and wants reduced.","stepsToReproduce":"","expectedBehavior":"","actualBehavior":"","attachmentNotes":""}

Example 5 — Thread (3 messages from same author), medium confidence
Input:
"yo my clan disappeared??"
"like the whole roster is empty"
"i was leader yesterday now it says join a clan"
Output:
{"relevant":true,"type":"BUG","confidence":"medium","sentiment":"negative","originalMessage":"yo my clan disappeared??\\nlike the whole roster is empty\\ni was leader yesterday now it says join a clan","summary":"Clan membership lost; UI prompts to rejoin","description":"The player was clan leader yesterday, but today the clan roster appears empty and the UI prompts them to join a clan; no error code was reported.","stepsToReproduce":"","expectedBehavior":"","actualBehavior":"","attachmentNotes":""}

Example 6 — Multi-item positive feedback, medium confidence
Input: "Trees on the map, fixed steps count (for me) , new visuals in in step screen, new xp icon visual in cards.."
Output:
{"relevant":true,"type":"FEEDBACK","confidence":"medium","sentiment":"positive","originalMessage":"Trees on the map, fixed steps count (for me) , new visuals in in step screen, new xp icon visual in cards..","summary":"Player notes new visuals and fixed step count","description":"The player welcomes several recent updates: trees now appear on the map, the step counter is corrected for their account, the steps screen has refreshed visuals, and the card XP icon has a new design.","stepsToReproduce":"","expectedBehavior":"","actualBehavior":"","attachmentNotes":""}`;

const GROUPING_SYSTEM_PROMPT = `You group MWO player reports by IDENTICAL player-visible symptom. The dashboard uses these groups to count "how many distinct players hit this exact thing" — over-grouping inflates fake duplicates, under-grouping fragments real ones.

THE SAME-SYMPTOM TEST
Two entries belong together only if a player describing each in their own words would naturally produce the SAME single-sentence headline. If you have to bend or generalize the wording to make them match, they do not match.

COMMON FAILURE MODES — AVOID
1. Feature-area grouping: "anything about clans" → one bucket. WRONG. Group by the observation, not the feature it lives in.
2. Symptom blending: "game is slow to load" + "game froze on dice roll" → both speed-related. WRONG. Slow loading ≠ in-action freeze. Different symptoms.
3. Wording fixation: "cards are gone" and "portfolio is empty" describe the same observation. DO group them.
4. Root-cause speculation: do not merge "rent not paid out" and "currency wrong after logout" because both might be a sync bug. Players don't see root causes; they see symptoms.
5. Cross-type merging: a BUG entry and a FEEDBACK entry NEVER share a group, even with the same surface wording.

MWO SYNONYM HINTS (these surface terms refer to the SAME thing)
- cards / portfolio cards / property cards / properties / deeds
- coins / cash / in-game currency  (gems is SEPARATE — premium currency)
- roll / dice / dice roll
- clan / guild  (community sometimes says guild)
- mission / quest / daily / weekly task
- Chance card and Community Chest card are DISTINCT — never merge.

LABEL FORMAT — MANDATORY
groupLabel must be: "[Feature] — [Symptom]"

Feature MUST be one of:
  Portfolio, Dice, Clan, Auction, Trade, Mission, Shop, Leaderboard,
  Chance, Community Chest, Login, Payment, City, Event, UI, Performance, Other

Symptom: short noun-phrase describing what the player sees, ≤6 words, neutral.

Good labels:
  "Portfolio — Cards disappear after logout"
  "Dice — Roll button unresponsive after patch"
  "Clan — Member list shows zero online"
  "Payment — Gems not delivered after purchase"
  "Performance — Long freeze when rolling dice"

Banned labels (too vague — never emit):
  "UI issue", "Portfolio bug", "Clan stuff", "Various login problems", "General feedback"

KEY FORMAT
groupKey: lower-kebab-case slug derived from the label, prefixed by "bug-" or "feedback-" matching the entry type.

  "Portfolio — Cards disappear after logout"
   → "bug-portfolio-cards-disappear-after-logout"

Cap at ~60 chars. If too long, shorten the symptom (not the feature).

REUSE RULES
- If an existing group's label fits the new entry's symptom EXACTLY, reuse the existing key character-for-character. Do not invent a near-duplicate.
- If an existing group is broad/vague ("UI — Issue"), DO NOT feed it; emit null and let a tighter group form later.
- Never rename an existing group's label — copy it exactly when reusing.
- Search every existing label before creating a new one — semantic duplicates (different wording, same symptom) are the most common error.

STANDALONE BIAS
When fewer than 2 entries in the batch (and zero in EXISTING) clearly share the symptom, return null. Premature grouping poisons the dashboard; single-entry standalones are cheap to merge later. When in doubt → null.

LANGUAGE
Group across languages by symptom. Polish "Karty zniknęły po wylogowaniu" and English "Cards gone after I logged out" belong in the SAME group. Always emit the label in English.

EXAMPLE
EXISTING GROUPS:
  "bug-portfolio-cards-disappear-after-logout": "Portfolio — Cards disappear after logout"
  "feedback-dice-cost-too-high":                "Dice — Roll cost feels too expensive"

NEW ENTRIES:
  [0] BUG: Cards gone after re-login
      Player had 12 cards, opened the game, 0 cards. Restart did not help.
  [1] BUG: Game crashes on dice roll
      App closes whenever the dice button is tapped.
  [2] FEEDBACK: 50 coins per dice is too much
      Dice rolls cost 50 coins which feels excessive.
  [3] BUG: Portfolio empty after sign-out
      All properties vanished after logging back in.
  [4] BUG: App freezes when opening the dice screen
      Dice tab loads but UI is frozen for ~15 seconds.

Output:
{
  "assignments": [
    { "index": 0, "groupKey": "bug-portfolio-cards-disappear-after-logout", "groupLabel": "Portfolio — Cards disappear after logout" },
    { "index": 1, "groupKey": null, "groupLabel": null },
    { "index": 2, "groupKey": "feedback-dice-cost-too-high", "groupLabel": "Dice — Roll cost feels too expensive" },
    { "index": 3, "groupKey": "bug-portfolio-cards-disappear-after-logout", "groupLabel": "Portfolio — Cards disappear after logout" },
    { "index": 4, "groupKey": null, "groupLabel": null }
  ]
}

Notes:
- [0] and [3] reuse the existing group: same symptom, different wording.
- [1] (crash) and [4] (freeze) are NOT merged — crash ≠ freeze even though both involve the dice screen. Both standalone for now.
- [2] reuses the existing feedback group.

Return ONLY the JSON object: { "assignments": [...] }.`;

async function withRetry(fn, retries = 1, delayMs = 2000, attempt = 0) {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0) {
      const wait = delayMs * Math.pow(2, attempt);
      console.warn(`[${ts()}] Retrying after error (${retries} left, wait ${wait}ms): ${err.message}`);
      await new Promise((res) => setTimeout(res, wait));
      return withRetry(fn, retries - 1, delayMs, attempt + 1);
    }
    throw err;
  }
}

async function analyzeImage(imageUrl, model, messageText = '') {
  const client = getClient();
  const trimmed = (messageText || '').trim();
  const userContent = [
    {
      type: 'text',
      text: trimmed
        ? `Player message accompanying this screenshot:\n${trimmed}`
        : 'No accompanying player message — set contradictsMessage to false.',
    },
    { type: 'image_url', image_url: { url: imageUrl } },
  ];

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 600,
  });

  const raw = response.choices[0].message.content.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Vision returned invalid JSON: ${raw.slice(0, 200)}`);
  }
  return {
    screenContext: typeof parsed.screenContext === 'string' ? parsed.screenContext : '',
    visibleIssue:  typeof parsed.visibleIssue  === 'string' ? parsed.visibleIssue  : '',
    contradictsMessage: parsed.contradictsMessage === true,
  };
}

async function classifyThread(threadText, model) {
  const client = getClient();
  const kbRules = loadKBRules('classification').concat(loadKBRules('relevance'));
  const systemPrompt = kbRules.length > 0
    ? CLASSIFICATION_SYSTEM_PROMPT +
      '\n\n// LEARNED RULES — apply these based on past moderator corrections:\n' +
      kbRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : CLASSIFICATION_SYSTEM_PROMPT;
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: threadText },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1000,
  });
  const raw = response.choices[0].message.content.trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI returned invalid JSON for classification: ${raw.slice(0, 200)}`);
  }
}

async function groupEntries(newRows, existingGroupKeys, model, maxTokens = 2000) {
  if (newRows.length === 0) return [];

  const client = getClient();

  const existingList = existingGroupKeys.length > 0
    ? existingGroupKeys.map(g => `  "${g.key}": "${g.label}"`).join('\n')
    : '  (none yet)';

  const newList = newRows.map((r, i) =>
    `[${i}] ${r.type}: ${r.summary}\n  ${r.description}`
  ).join('\n\n');

  const groupingRules = loadKBRules('grouping');
  const learnedSection = groupingRules.length > 0
    ? '\n\nLEARNED GROUPING RULES — apply these based on past moderator corrections:\n' +
      groupingRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '';
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: GROUPING_SYSTEM_PROMPT + learnedSection,
      },
      {
        role: 'user',
        content:
          `EXISTING GROUPS (reuse these keys if entry matches — do not rename):\n${existingList}\n\nNEW ENTRIES TO ASSIGN:\n${newList}`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
  });

  const raw = response.choices[0].message.content.trim();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.assignments)) return [];
    return parsed.assignments.map(a => ({
      index:      a.index,
      groupKey:   (a.groupKey   && a.groupKey   !== 'null') ? a.groupKey   : null,
      groupLabel: (a.groupLabel && a.groupLabel !== 'null') ? a.groupLabel : null,
    }));
  } catch {
    throw new Error(`OpenAI returned invalid JSON for grouping: ${raw.slice(0, 200)}`);
  }
}

async function generateTLDR(rows, model) {
  const client = getClient();

  const bugRows = rows.filter((r) => r.type === 'BUG');
  const fbRows = rows.filter((r) => r.type === 'FEEDBACK');
  const bugLines = bugRows.map((r) => `- ${r.summary}: ${r.description}`).join('\n') || 'none';
  const fbLines = fbRows.map((r) => `- ${r.summary}: ${r.description}`).join('\n') || 'none';
  const input = `BUGS (${bugRows.length}):\n${bugLines}\n\nFEEDBACK (${fbRows.length}):\n${fbLines}`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a QA lead writing an executive TL;DR for the Monopoly World mobile game team leadership.\n\n' +
          'Given these classified Discord reports, return a JSON object:\n' +
          '{\n' +
          '  "assessment": "2-sentence overall health assessment of community sentiment",\n' +
          '  "themes": [\n' +
          '    { "title": "Short theme name", "detail": "1-2 sentences grouping similar issues — mention counts when multiple players reported the same thing" }\n' +
          '  ],\n' +
          '  "feedbackTrend": "1-2 sentences on what players want or appreciate",\n' +
          '  "actionItems": ["Concise dev action 1", "Concise dev action 2", "Concise dev action 3"]\n' +
          '}\n\n' +
          'Rules:\n' +
          '- themes: group SIMILAR bugs together (max 4 themes). Never list each report individually.\n' +
          '- If multiple players reported the same issue, state that explicitly.\n' +
          '- Be specific and actionable. Plain text only inside strings.',
      },
      { role: 'user', content: input },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 800,
  });
  const raw = response.choices[0].message.content.trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI returned invalid JSON for TL;DR: ${raw.slice(0, 200)}`);
  }
}

module.exports = { analyzeImage, classifyThread, groupEntries, generateTLDR, withRetry };
