require('dotenv').config();

function getConfig() {
  const base  = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const proj  = process.env.JIRA_PROJECT_KEY;
  if (!base || !email || !token || !proj) {
    throw new Error('Missing Jira config. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY in .env');
  }
  return { base, email, token, proj };
}

async function jiraFetch(method, path, body) {
  const cfg = getConfig();
  const url = `${cfg.base}/rest/api/3${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64'),
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  if (!res.ok) {
    console.error(`[Jira] ${method} ${path} → ${res.status}`, text);
    const msg = (json.errorMessages || []).join(', ')
      || Object.values(json.errors || {}).join(', ')
      || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function buildDescription(rep, groupMembers) {
  const content = [];

  function addParagraph(text) {
    if (!text || !text.trim()) return;
    content.push({ type: 'paragraph', content: [{ type: 'text', text: text.trim() }] });
  }

  function addLabeledSection(label, text) {
    if (!text || !text.trim()) return;
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: label, marks: [{ type: 'strong' }] }],
    });
    content.push({ type: 'paragraph', content: [{ type: 'text', text: text.trim() }] });
  }

  addParagraph(rep.description);
  addLabeledSection('Steps to Reproduce:', rep.stepsToReproduce);
  addLabeledSection('Expected Behavior:',  rep.expectedBehavior);
  addLabeledSection('Actual Behavior:',    rep.actualBehavior);
  addLabeledSection('Attachment Notes:',   rep.attachmentNotes);

  // Discord links
  const links = groupMembers
    .filter(m => m.messageUrl)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (links.length > 0) {
    const label = links.length > 1
      ? `Discord Messages (${links.length} reports):`
      : 'Discord Message:';
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: label, marks: [{ type: 'strong' }] }],
    });
    content.push({
      type: 'bulletList',
      content: links.map(m => ({
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: `@${m.authorUsername || 'unknown'}  ${m.date}  ` },
            { type: 'text', text: m.messageUrl, marks: [{ type: 'link', attrs: { href: m.messageUrl } }] },
          ],
        }],
      })),
    });
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Community report' }] });
  }

  return { type: 'doc', version: 1, content };
}

async function createIssue({ rep, groupMembers, similarCount, affectsVersion }) {
  const cfg = getConfig();

  const reportType = rep.type === 'BUG' ? 'Bug' : 'Feedback';

  let sentiment = 'Neutral';
  for (const m of groupMembers) {
    if (Array.isArray(m.tags) && m.tags.includes('positive')) { sentiment = 'Positive'; break; }
    if (Array.isArray(m.tags) && m.tags.includes('negative')) { sentiment = 'Negative'; break; }
  }

  const fields = {
    project:     { key: cfg.proj },
    summary:     (rep.summary || rep.originalMessage || 'Community Report').slice(0, 255),
    description: buildDescription(rep, groupMembers),
    issuetype:   { name: process.env.JIRA_ISSUE_TYPE || 'Task' },
  };

  // Custom fields — only included when the env var is configured
  function cf(envVar, value) {
    const id = process.env[envVar];
    if (id && value !== undefined && value !== null && value !== '') fields[id] = value;
  }

  cf('JIRA_FIELD_REPORT_TYPE',      { value: reportType });
  cf('JIRA_FIELD_SENTIMENT',        { value: sentiment });
  cf('JIRA_FIELD_DISCORD_USERNAME', rep.authorUsername || '');
  cf('JIRA_FIELD_PLAYER_ID',        rep.authorId || '');
  cf('JIRA_FIELD_SIMILAR_COUNT',    similarCount);
  cf('JIRA_FIELD_DASHBOARD_LINK',   process.env.DASHBOARD_URL || '');

  if (affectsVersion) {
    fields.versions = [{ name: affectsVersion }];
  }

  const issue = await jiraFetch('POST', '/issue', { fields });
  return { key: issue.key, url: `${cfg.base}/browse/${issue.key}` };
}

async function updateIssue(jiraKey, fields) {
  return jiraFetch('PUT', `/issue/${jiraKey}`, { fields });
}

async function listFields() {
  return jiraFetch('GET', '/field');
}

module.exports = { createIssue, updateIssue, listFields };
