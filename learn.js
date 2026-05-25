require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('./config.json');

const FEEDBACK_DIR     = path.resolve('feedback');
const CORRECTIONS_FILE = path.join(FEEDBACK_DIR, 'corrections.json');
const KB_FILE          = path.join(FEEDBACK_DIR, 'knowledge_base.json');

function loadCorrections() {
  if (!fs.existsSync(CORRECTIONS_FILE)) return { corrections: [] };
  try { return JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8')); }
  catch { return { corrections: [] }; }
}

function loadKB() {
  if (!fs.existsSync(KB_FILE)) return { rules: [] };
  try { return JSON.parse(fs.readFileSync(KB_FILE, 'utf8')); }
  catch { return { rules: [] }; }
}

async function deriveRules(pending) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model  = config.learnModel || config.openaiModel || 'gpt-4o';

  const correctionText = pending.map((c, i) => {
    const ent = c.entry;
    const entryDesc = ent
      ? `Type=${ent.type}, Summary="${ent.summary}", Original="${ent.originalMessage}"`
      : 'N/A';
    return `[${i + 1}] Issue: ${c.issueType}\nEntry: ${entryDesc}\nModerator note: "${c.reason}"`;
  }).join('\n\n');

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are helping improve an AI classifier for Discord messages from players of Monopoly World ' +
          '(a mobile Monopoly-based city-building game).\n\n' +
          'A human moderator flagged entries that were classified or grouped incorrectly. ' +
          'For each correction, derive a clear, reusable rule that prevents this mistake in the future.\n\n' +
          'Rules must be:\n' +
          '- Specific and testable, not vague\n' +
          '- Applicable to multiple future cases (not just this one entry)\n' +
          '- Written as: "When [condition], [action] because [reason]"\n\n' +
          'Category: use "classification" for BUG/FEEDBACK type errors, ' +
          '"relevance" for false positives/negatives, "grouping" for wrong groupings.\n\n' +
          'Return ONLY valid JSON: {"rules":[{"category":"classification|relevance|grouping","rule":"..."}]}',
      },
      {
        role: 'user',
        content: `Moderator corrections:\n\n${correctionText}\n\nDerive rules.`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1000,
  });

  const raw = response.choices[0].message.content.trim();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.rules) ? parsed.rules : [];
  } catch {
    console.error('[LEARN] Invalid JSON from OpenAI:', raw.slice(0, 200));
    return [];
  }
}

async function processCorrections() {
  const data    = loadCorrections();
  const pending = data.corrections.filter(c => c.status === 'pending');

  if (pending.length === 0) {
    console.log('[LEARN] No pending corrections.');
    return { processed: 0, newRules: 0 };
  }

  console.log(`[LEARN] Processing ${pending.length} pending corrections...`);
  const newRules = await deriveRules(pending);

  const kb        = loadKB();
  const timestamp = new Date().toISOString();
  for (const rule of newRules) {
    kb.rules.push({
      id:        `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: timestamp,
      category:  rule.category,
      rule:      rule.rule,
    });
  }

  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  fs.writeFileSync(KB_FILE, JSON.stringify(kb, null, 2), 'utf8');

  for (const c of data.corrections) {
    if (c.status === 'pending') c.status = 'processed';
  }
  fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(data, null, 2), 'utf8');

  console.log(`[LEARN] Processed ${pending.length} corrections → ${newRules.length} new rules`);
  return { processed: pending.length, newRules: newRules.length };
}

module.exports = { processCorrections };
