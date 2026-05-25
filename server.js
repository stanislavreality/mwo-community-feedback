require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');

const { generateTLDR, withRetry } = require('./openai');
const { generatePDF }             = require('./report');
const config = require('./config.json');

const app  = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASS = process.env.ADMIN_PASS || process.env.DASHBOARD_PASS;
const GUEST_PASS = process.env.GUEST_PASS;

if (!ADMIN_PASS) {
  console.warn('[AUTH] ADMIN_PASS not set in .env — dashboard is unprotected (auto-admin)!');
} else {
  console.log('[AUTH] Login protected. Admin + Guest roles enabled.');
}

const DATA_FILE        = path.resolve('output', 'reports', 'data.json');
const INDEX_FILE       = path.resolve('output', 'reports', 'index.html');
const FEEDBACK_DIR     = path.resolve('feedback');
const CORRECTIONS_FILE = path.join(FEEDBACK_DIR, 'corrections.json');

fs.mkdirSync(FEEDBACK_DIR, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'mwo-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
}));

// ── Login page ────────────────────────────────────────────────────────────

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MWO Dashboard — Login</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:#f6f5f4;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#ffffff;border:1px solid #e5e3df;border-radius:16px;padding:44px 40px;
  width:380px;max-width:92vw;
  box-shadow:rgba(15,15,15,0.08) 0px 8px 40px -8px}
.logo{font-size:22px;font-weight:800;color:#1a1a1a;text-align:center;margin-bottom:5px;
  letter-spacing:-.4px}
.subtitle{font-size:13px;color:#a4a097;text-align:center;margin-bottom:32px}
label{display:block;font-size:11px;font-weight:600;color:#5d5b54;
  text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px}
input[type=password]{width:100%;padding:11px 14px;border:1px solid #c8c4be;border-radius:9px;
  font-size:14px;font-family:inherit;color:#1a1a1a;background:#fff;
  transition:border-color .15s,box-shadow .15s}
input[type=password]:focus{outline:none;border-color:#5645d4;
  box-shadow:0 0 0 3px rgba(86,69,212,.12)}
.btn{width:100%;padding:12px;border-radius:9px;border:none;background:#5645d4;color:#fff;
  font-size:14px;font-weight:600;cursor:pointer;margin-top:20px;
  transition:background .15s;font-family:inherit;letter-spacing:-.1px}
.btn:hover{background:#4534b3}
.error{background:#fde8e8;border:1px solid #f5c6c6;color:#c0392b;border-radius:8px;
  padding:10px 14px;font-size:13px;margin-bottom:18px;line-height:1.4}
</style>
</head>
<body>
<div class="card">
  <div class="logo">&#127760; Monopoly World</div>
  <div class="subtitle">Community Feedback Dashboard</div>
  <!--ERROR-->
  <form method="POST" action="/login">
    <label for="password">Password</label>
    <input type="password" id="password" name="password"
      placeholder="Enter password…" autocomplete="current-password" autofocus>
    <button type="submit" class="btn">Sign in</button>
  </form>
</div>
</body>
</html>`;

// ── Auth routes ───────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.session.role) return res.redirect('/');
  res.send(LOGIN_HTML);
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  let role = null;
  if (ADMIN_PASS && password === ADMIN_PASS) role = 'admin';
  else if (GUEST_PASS && password === GUEST_PASS) role = 'guest';
  else if (!ADMIN_PASS) role = 'admin';

  if (role) {
    req.session.role = role;
    return req.session.save(() => res.redirect('/'));
  }
  res.send(LOGIN_HTML.replace('<!--ERROR-->', '<p class="error">Nieprawidłowe hasło. Spróbuj ponownie.</p>'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── Auth middleware ───────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.role) return next();
  if (!ADMIN_PASS) {
    req.session.role = 'admin';
    return req.session.save(() => next());
  }
  // API requests get 401 instead of redirect
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session.role === 'admin') return next();
  res.status(403).json({ error: 'Brak uprawnień — wymagany dostęp admina.' });
}

// All routes below this point require a valid session
app.use(requireAuth);
app.use('/output', express.static(path.resolve('output')));

// ── Public (read-only) endpoints ──────────────────────────────────────────

app.get('/api/me', (req, res) => {
  res.json({ role: req.session.role || 'guest' });
});

app.get('/', (req, res) => {
  if (!fs.existsSync(INDEX_FILE)) {
    return res.status(404).send('Brak raportu. Uruchom najpierw: node index.js --manual --days 7');
  }
  let html = fs.readFileSync(INDEX_FILE, 'utf8');
  const jiraOk = !!(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN && process.env.JIRA_PROJECT_KEY);
  html = html.replace('<head>', `<head>\n<script>window.__role='${req.session.role}';window.__jiraConfigured=${jiraOk};</script>`);
  res.send(html);
});

app.get('/api/kb', (req, res) => {
  try {
    const kbFile = path.join(FEEDBACK_DIR, 'knowledge_base.json');
    if (!fs.existsSync(kbFile)) return res.json({ rules: [] });
    const kb = JSON.parse(fs.readFileSync(kbFile, 'utf8'));
    res.json(kb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin-only write endpoints ────────────────────────────────────────────

app.post('/api/tag', requireAdmin, (req, res) => {
  try {
    const { groupKey, messageUrl, tag, active } = req.body;
    const ALLOWED_TAGS = ['forwarded', 'fixed', 'slack', 'jira', 'invalid', 'positive', 'negative'];
    if (!ALLOWED_TAGS.includes(tag) || (!groupKey && !messageUrl)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const opposite = tag === 'positive' ? 'negative' : tag === 'negative' ? 'positive' : null;

    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    for (const entry of raw.entries) {
      const matches = groupKey ? entry.groupKey === groupKey : entry.messageUrl === messageUrl;
      if (!matches) continue;
      if (!Array.isArray(entry.tags)) entry.tags = [];
      if (active && !entry.tags.includes(tag)) entry.tags.push(tag);
      if (!active) { const i = entry.tags.indexOf(tag); if (i !== -1) entry.tags.splice(i, 1); }
      if (active && opposite) {
        const j = entry.tags.indexOf(opposite);
        if (j !== -1) entry.tags.splice(j, 1);
      }
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(raw, null, 2), 'utf8');

    const { generateHTML } = require('./report');
    generateHTML([], new Date());

    res.json({ ok: true });
  } catch (err) {
    console.error('[TAG API error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/group', requireAdmin, (req, res) => {
  try {
    const { messageUrls, label } = req.body;
    if (!Array.isArray(messageUrls) || messageUrls.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 messageUrls' });
    }
    const raw         = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const newGroupKey = 'grp_' + Date.now();
    const urlSet      = new Set(messageUrls);
    let   resolvedLabel = label || null;

    for (const entry of raw.entries) {
      if (urlSet.has(entry.messageUrl)) {
        if (!resolvedLabel) resolvedLabel = entry.summary || newGroupKey;
        entry.groupKey   = newGroupKey;
        entry.groupLabel = resolvedLabel;
      }
    }
    for (const entry of raw.entries) {
      if (entry.groupKey === newGroupKey) entry.groupLabel = resolvedLabel;
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(raw, null, 2), 'utf8');
    const { generateHTML } = require('./report');
    generateHTML([], new Date());
    res.json({ ok: true, groupKey: newGroupKey, label: resolvedLabel });
  } catch (err) {
    console.error('[GROUP API error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ungroup', requireAdmin, (req, res) => {
  try {
    const { messageUrl } = req.body;
    if (!messageUrl) return res.status(400).json({ error: 'Need messageUrl' });

    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let removedGroupKey = null;

    for (const entry of raw.entries) {
      if (entry.messageUrl === messageUrl) {
        removedGroupKey = entry.groupKey || null;
        delete entry.groupKey;
        delete entry.groupLabel;
      }
    }

    if (removedGroupKey) {
      const survivors = raw.entries.filter(e => e.groupKey === removedGroupKey);
      if (survivors.length === 1) {
        delete survivors[0].groupKey;
        delete survivors[0].groupLabel;
      }
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(raw, null, 2), 'utf8');
    const { generateHTML } = require('./report');
    generateHTML([], new Date());
    res.json({ ok: true });
  } catch (err) {
    console.error('[UNGROUP API error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tldr', requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.body;

    if (!fs.existsSync(DATA_FILE)) {
      return res.status(404).json({ error: 'Brak danych. Uruchom najpierw analizę.' });
    }

    const raw     = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const entries = raw.entries || [];

    const filtered = entries.filter(e => {
      const d = e.date.slice(0, 10);
      return (!from || d >= from) && (!to || d <= to);
    });

    if (filtered.length === 0) {
      return res.status(400).json({ error: 'Brak wpisów w wybranym przedziale dat.' });
    }

    const model       = config.openaiModel || 'gpt-4o';
    const periodLabel = from && to ? `${from} – ${to}` : (from ? `od ${from}` : (to ? `do ${to}` : 'all time'));

    console.log(`[TLDR] Generating for ${filtered.length} entries (${periodLabel})...`);
    const tldrObj = await withRetry(() => generateTLDR(filtered, model));
    const pdfPath = await generatePDF(filtered, new Date(), periodLabel, tldrObj);

    res.json({ ok: true, file: path.basename(pdfPath) });
  } catch (err) {
    console.error('[TLDR API error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/feedback', requireAdmin, (req, res) => {
  try {
    const { messageUrl, issueType, reason, entrySnapshot } = req.body;
    const ALLOWED_ISSUES = ['false_positive', 'wrong_classification', 'wrong_grouping', 'wrong_summary'];
    if (!messageUrl || !ALLOWED_ISSUES.includes(issueType) || !reason) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const data = fs.existsSync(CORRECTIONS_FILE)
      ? JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8'))
      : { corrections: [] };

    data.corrections.push({
      id:        `c_${Date.now()}`,
      timestamp: new Date().toISOString(),
      status:    'pending',
      messageUrl,
      issueType,
      reason,
      entry:     entrySnapshot || null,
    });

    fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    console.error('[FEEDBACK API error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/learn', requireAdmin, async (req, res) => {
  try {
    const { processCorrections } = require('./learn');
    const result = await processCorrections();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[LEARN API error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jira/sync-counts', requireAdmin, async (req, res) => {
  try {
    const { updateIssue } = require('./jira');
    const countFieldId = process.env.JIRA_FIELD_SIMILAR_COUNT;
    if (!countFieldId) return res.status(400).json({ error: 'JIRA_FIELD_SIMILAR_COUNT not set in .env' });

    const raw     = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const entries = raw.entries || [];

    // Step 1: find which groupKey (or standalone entry) maps to which jiraKey
    const groupKeyToJiraKey = {};
    for (const e of entries) {
      if (e.jiraKey && e.groupKey && !groupKeyToJiraKey[e.groupKey]) {
        groupKeyToJiraKey[e.groupKey] = e.jiraKey;
      }
    }

    // Step 2: count ALL entries per jiraKey (including new ones grouped after push)
    const keyToCount = {};
    for (const e of entries) {
      const jiraKey = e.groupKey
        ? (groupKeyToJiraKey[e.groupKey] || null)
        : (e.jiraKey || null);
      if (jiraKey) keyToCount[jiraKey] = (keyToCount[jiraKey] || 0) + 1;
    }

    const updated = [];
    const errors  = [];

    for (const [jiraKey, count] of Object.entries(keyToCount)) {
      try {
        await updateIssue(jiraKey, { [countFieldId]: count });
        updated.push({ jiraKey, count });
      } catch (err) {
        errors.push({ jiraKey, error: err.message });
      }
    }

    res.json({ ok: true, updated, errors });
  } catch (err) {
    console.error('[JIRA SYNC error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jira/push', requireAdmin, async (req, res) => {
  try {
    const { from, to, affectsVersion } = req.body;
    const { createIssue } = require('./jira');

    const raw     = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const entries = raw.entries || [];

    // Entries tagged 'jira' within the requested date range
    const tagged = entries.filter(e => {
      if (!Array.isArray(e.tags) || !e.tags.includes('jira')) return false;
      const d = e.date.slice(0, 10);
      return (!from || d >= from) && (!to || d <= to);
    });

    if (tagged.length === 0) {
      return res.json({ ok: true, created: [], skipped: [], errors: [] });
    }

    // Deduplicate: one entry per group (or per standalone entry)
    const seen      = new Set();
    const toProcess = [];
    for (const entry of tagged) {
      const key = entry.groupKey || entry.messageUrl;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      toProcess.push(entry);
    }

    const created = [];
    const skipped = [];
    const errors  = [];

    for (const rep of toProcess) {
      const groupMembers = rep.groupKey
        ? entries.filter(e => e.groupKey === rep.groupKey)
        : [rep];

      const alreadyPushed = groupMembers.some(m => m.jiraKey);
      if (alreadyPushed) {
        const existingKey = groupMembers.find(m => m.jiraKey)?.jiraKey;
        skipped.push({ summary: rep.summary, jiraKey: existingKey });
        continue;
      }

      try {
        const { key, url } = await createIssue({
          rep,
          groupMembers,
          similarCount:   groupMembers.length,
          affectsVersion: affectsVersion || null,
        });
        for (const m of groupMembers) {
          m.jiraKey = key;
          m.jiraUrl = url;
        }
        created.push({ summary: rep.summary, jiraKey: key, jiraUrl: url });
      } catch (err) {
        errors.push({ summary: rep.summary, error: err.message });
      }
    }

    if (created.length > 0) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(raw, null, 2), 'utf8');
      const { generateHTML } = require('./report');
      generateHTML([], new Date());
    }

    res.json({ ok: true, created, skipped, errors });
  } catch (err) {
    console.error('[JIRA PUSH error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Web UI → http://0.0.0.0:${PORT}`);
  try {
    const { generateHTML } = require('./report');
    generateHTML([], new Date());
  } catch (err) {
    console.warn('[REBUILD] Could not regenerate HTML on startup:', err.message);
  }
});
