const OpenAI = require('openai');

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

const VISION_SYSTEM_PROMPT =
  'You are analyzing a screenshot from a mobile game called Monopoly World ' +
  '(a Monopoly-based city-building game). The player sent this image alongside their message. ' +
  'Describe precisely: what UI is shown, what error or issue is visible, what game state is depicted. ' +
  'Be specific about numbers, buttons, error codes, and anything unusual. ' +
  'Your description will be used to classify this as a bug or feedback.';

const CLASSIFICATION_SYSTEM_PROMPT =
  'You are a QA analyst for a mobile game called Monopoly World (a Monopoly-based city-building mobile game). ' +
  'Analyze the following Discord message(s) from a player.\n\n' +
  'FIRST decide if this message is relevant game feedback or a bug report:\n' +
  '- relevant=true: message clearly describes a game experience, issue, bug, feature request, or specific feedback about the game\n' +
  '- relevant=false: message is casual chit-chat, a greeting, a reaction/meme, too vague to be actionable, or not about the game at all\n\n' +
  'If relevant=false, still fill the other fields with empty strings.\n' +
  'If relevant=true, classify as BUG or FEEDBACK and fill all fields thoroughly.\n' +
  'Use only information provided — do not invent details.\n\n' +
  'Respond with ONLY a valid JSON object in this exact format:\n' +
  '{\n' +
  '  "relevant": true or false,\n' +
  '  "type": "BUG" or "FEEDBACK",\n' +
  '  "originalMessage": "exact original message text",\n' +
  '  "summary": "one sentence summary",\n' +
  '  "description": "detailed description of what happened",\n' +
  '  "stepsToReproduce": "if bug: how to reproduce it, or \'unknown\'",\n' +
  '  "expectedBehavior": "what the player expected",\n' +
  '  "actualBehavior": "what actually happened",\n' +
  '  "attachmentNotes": "description from vision analysis or empty string"\n' +
  '}';

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

async function analyzeImage(imageUrl, model) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: imageUrl } }],
      },
    ],
    max_tokens: 500,
  });
  return response.choices[0].message.content.trim();
}

async function classifyThread(threadText, model) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
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

module.exports = { analyzeImage, classifyThread, generateTLDR, withRetry };
