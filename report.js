const fs   = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const db = require('./db');

const OUTPUT_DIR  = path.resolve('output');
const REPORTS_DIR = path.join(OUTPUT_DIR, 'reports');
const TLDR_DIR    = path.join(OUTPUT_DIR, 'tldr');
const DATA_FILE   = path.join(REPORTS_DIR, 'data.json');
const INDEX_FILE  = path.join(REPORTS_DIR, 'index.html');

function ts()   { return new Date().toISOString(); }
function pad(n) { return String(n).padStart(2, '0'); }
function runId(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function ensureDirs() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.mkdirSync(TLDR_DIR,    { recursive: true });
}

// ── Data store ───────────────────────────────────────────────────────────────

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { lastTimestamp: null, entries: [] };
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // Migrate old { runs: [] } format automatically
    if (d.runs && !d.entries) {
      const entries = [];
      for (const run of d.runs) entries.push(...(run.rows || []));
      return { lastTimestamp: d.runs[0]?.generatedAt || null, entries };
    }
    return d;
  } catch { return { lastTimestamp: null, entries: [] }; }
}

function entryKey(r) {
  return r.messageUrl || `${r.date}__${r.authorUsername}__${r.type}`;
}

function loadLastTimestamp() {
  return loadData().lastTimestamp;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

function buildHTML(entries) {
  const safeEntries = JSON.stringify(entries).replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MWO Community Reports</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#ffffff;--surface:#f6f5f4;--card:#ffffff;--card-h:#fafaf9;
  --border:#e5e3df;--border2:#c8c4be;
  --text:#1a1a1a;--muted:#a4a097;--dim:#787671;--slate:#5d5b54;--charcoal:#37352f;
  --bug:#e03131;--fb:#1aae39;--blue:#5645d4;--primary:#5645d4;
  --primary-pressed:#4534b3;--link:#0075de;
  --tint-rose:#fde0ec;--tint-mint:#d9f3e1;--tint-lavender:#e6e0f5;
  --tint-peach:#ffe8d4;--tint-sky:#dcecfa;
  --purple-800:#391c57;--orange-deep:#793400;
}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;
  background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column}

/* ── Topbar ── */
.topbar{background:var(--card);border-bottom:1px solid var(--border);
  padding:0 24px;height:52px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;position:sticky;top:0;z-index:10}
.logo{font-size:15px;font-weight:700;letter-spacing:-.3px;white-space:nowrap}
.sep{width:1px;height:18px;background:var(--border2)}
.sep-v{width:1px;height:18px;background:var(--border2);margin:0 4px;flex-shrink:0}
.topbar-actions{display:flex;align-items:center;gap:6px}

/* ── Date filter ── */
.date-range{display:flex;align-items:center;gap:6px;font-size:13px}
input[type="date"]{
  background:var(--card);border:1px solid var(--border2);border-radius:6px;
  color:var(--text);padding:5px 9px;font-size:12px;cursor:pointer;
  color-scheme:light}
input[type="date"]:focus{outline:none;border-color:var(--primary)}
.range-sep{color:var(--muted);font-size:12px}

/* ── Preset chips ── */
.presets{display:flex;gap:6px;flex-wrap:wrap}
.chip{padding:5px 12px;border-radius:9999px;border:1px solid var(--border2);
  background:transparent;color:var(--slate);font-size:12px;font-weight:500;cursor:pointer;
  transition:all .15s;white-space:nowrap}
.chip:hover{border-color:var(--primary);color:var(--primary)}
.chip.active{background:var(--text);border-color:var(--text);color:#fff;font-weight:600}
.chip.tag-filter-forwarded.active{background:var(--orange-deep);border-color:var(--orange-deep);color:#fff}
.chip.tag-filter-fixed.active{background:#1aae39;border-color:#1aae39;color:#fff}
.chip.tag-filter-none.active{background:var(--slate);border-color:var(--slate);color:#fff}
.chip.sentiment-filter-positive.active{background:#27ae60;border-color:#27ae60;color:#fff}
.chip.sentiment-filter-negative.active{background:#e74c3c;border-color:#e74c3c;color:#fff}

/* ── Filter bar ── */
.filter-bar{background:var(--card);border-bottom:1px solid var(--border);
  padding:0 24px;min-height:44px;display:flex;align-items:center;
  justify-content:space-between;position:sticky;top:52px;z-index:9;gap:12px;flex-wrap:wrap}
.filter-left{display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap;padding:5px 0}
.filter-sep{width:1px;height:16px;background:var(--border2);flex-shrink:0}

/* ── Stats chips ── */
.stats-row{display:flex;gap:6px;flex-wrap:nowrap;flex-shrink:0;padding:5px 0}
.stat-chip{background:var(--surface);border:1px solid var(--border);
  border-radius:6px;padding:4px 12px;font-size:12px;white-space:nowrap;color:var(--charcoal)}
.stat-chip b{font-size:15px;font-weight:800;margin-right:4px;color:var(--text)}

/* ── Type filter chips ── */
.chip.type-bug.active{background:var(--tint-rose);border-color:#f0b0b0;color:#c0392b}
.chip.type-fb.active{background:var(--tint-mint);border-color:#90d0a0;color:#1a7a3a}

/* ── Action buttons ── */
.btn-action{padding:6px 14px;border-radius:8px;font-size:13px;font-weight:500;
  cursor:pointer;border:1px solid var(--border2);background:transparent;color:var(--charcoal);
  transition:background .15s,border-color .15s;white-space:nowrap}
.btn-action:hover{background:var(--surface);border-color:var(--border2)}
.btn-csv{color:var(--charcoal)}
.btn-tldr{background:var(--primary);border-color:var(--primary);color:#fff;font-weight:600}
.btn-tldr:hover{background:var(--primary-pressed);border-color:var(--primary-pressed);color:#fff}

/* ── Modals ── */
.overlay{position:fixed;inset:0;background:rgba(15,15,15,.45);display:none;
  align-items:center;justify-content:center;z-index:100}
.overlay.open{display:flex}
.modal{background:var(--card);border:1px solid var(--border);border-radius:12px;
  padding:28px;width:420px;max-width:92vw;display:flex;flex-direction:column;gap:18px;
  box-shadow:rgba(15,15,15,0.16) 0px 16px 48px -8px}
.modal h3{font-size:16px;font-weight:600;color:var(--text)}
.modal-note{font-size:13px;color:var(--slate);line-height:1.5}
.modal-warn{font-size:12px;color:#793400;background:var(--tint-peach);
  border:1px solid #e8c9a8;border-radius:8px;padding:10px 14px;line-height:1.5}
.modal-fields{display:flex;flex-direction:column;gap:10px}
.modal-fields label{font-size:11px;font-weight:600;color:var(--slate);
  text-transform:uppercase;letter-spacing:.5px;display:flex;flex-direction:column;gap:5px}
.modal-row{display:flex;gap:10px}
.modal-row label{flex:1}
.modal-actions{display:flex;gap:10px;justify-content:flex-end}
.btn-cancel{padding:8px 16px;border-radius:8px;border:1px solid var(--border2);
  background:transparent;color:var(--slate);font-size:13px;font-weight:500;cursor:pointer}
.btn-cancel:hover{background:var(--surface)}
.btn-primary{padding:8px 18px;border-radius:8px;border:none;font-size:13px;
  font-weight:600;cursor:pointer;transition:opacity .15s}
.btn-primary:disabled{opacity:.45;cursor:not-allowed}
.btn-go-csv{background:#1aae39;color:#fff}
.btn-go-tldr{background:var(--primary);color:#fff}
.modal-status{font-size:12px;color:var(--dim);min-height:18px}

/* ── Cards ── */
.cards-area{flex:1;padding:20px 24px;background:var(--surface)}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;
  overflow:hidden;transition:border-color .15s,box-shadow .15s;
  box-shadow:rgba(15,15,15,0.04) 0px 1px 2px 0px}
.card:hover{border-color:var(--border2);box-shadow:rgba(15,15,15,0.08) 0px 4px 12px 0px}
.card.grouped{cursor:pointer}
.card.grouped:hover{border-color:var(--primary);box-shadow:rgba(86,69,212,0.12) 0px 4px 12px 0px}
.card-banner{padding:9px 14px;display:flex;align-items:center;justify-content:space-between}
.card.bug .card-banner{background:var(--tint-rose)}
.card.fb  .card-banner{background:var(--tint-mint)}
.banner-type{font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase}
.card.bug .banner-type{color:#c0392b}
.card.fb  .banner-type{color:#1a7a3a}
.banner-meta{font-size:10px;color:var(--slate);text-align:right}
.card-body{padding:14px;display:flex;flex-direction:column;gap:9px}
.card-summary{font-size:14px;font-weight:600;line-height:1.4;color:var(--text)}
.card-desc{font-size:13px;color:var(--slate);line-height:1.55}
.fields{display:flex;flex-direction:column;gap:5px}
.frow{display:grid;grid-template-columns:68px 1fr;gap:6px;font-size:11px}
.flabel{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);padding-top:1px}
.fval{color:var(--dim);line-height:1.45}
.card-orig{border-top:1px solid var(--border);padding-top:9px}
.card-orig a,.card-orig span{font-size:11px;font-style:italic;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-orig a{color:var(--link);text-decoration:none}
.card-orig a:hover{text-decoration:underline}
.card-orig span{color:var(--dim)}

/* ── Tags ── */
.card-tags{padding:8px 14px 10px;border-top:1px solid var(--border);display:flex;gap:6px;flex-wrap:wrap}
.tag-btn{padding:2px 10px;border-radius:6px;border:1px solid var(--border);font-size:11px;font-weight:600;
  cursor:pointer;background:transparent;color:var(--dim);transition:all .15s;white-space:nowrap}
.tag-btn:hover{border-color:var(--border2);background:var(--surface)}
.tag-btn.tag-forwarded.active{background:var(--tint-peach);border-color:var(--tint-peach);color:var(--orange-deep)}
.tag-btn.tag-fixed.active{background:var(--tint-mint);border-color:var(--tint-mint);color:#1a7a3a}
.tag-btn.tag-slack.active{background:var(--tint-lavender);border-color:var(--tint-lavender);color:var(--purple-800)}
.tag-btn.tag-invalid.active{background:var(--surface);border-color:var(--border2);color:var(--slate)}
.tag-btn.tag-positive.active{background:#d4f0db;border-color:#a8dfb4;color:#1a7a3a}
.tag-btn.tag-negative.active{background:#fde0e0;border-color:#f0b0b0;color:#c0392b}
.tag-btn.tag-jira.active{background:#e6f0ff;border-color:#9eb9e8;color:#0055cc}
.jira-key-badge{display:inline-flex;align-items:center;gap:3px;background:#e6f0ff;color:#0055cc;
  border:1px solid #9eb9e8;border-radius:9999px;padding:2px 9px;font-size:10px;font-weight:700;
  letter-spacing:.3px;white-space:nowrap;text-decoration:none;transition:background .15s}
.jira-key-badge:hover{background:#cfe0ff}
.btn-slack{background:transparent;color:var(--charcoal)}
.btn-slack:hover{background:var(--surface)}
.chip.tag-filter-invalid.active{background:var(--slate);border-color:var(--slate);color:#fff}

/* ── Count badge ── */
.count-badge{display:inline-flex;align-items:center;background:var(--tint-lavender);
  color:var(--purple-800);border:1px solid var(--tint-lavender);border-radius:9999px;
  padding:1px 8px;font-size:9px;font-weight:700;letter-spacing:.3px;white-space:nowrap;
  margin-left:6px;vertical-align:middle}
.overall-badge{display:inline-flex;align-items:center;background:var(--surface);
  color:var(--dim);border:1px solid var(--border);border-radius:9999px;
  padding:1px 8px;font-size:9px;font-weight:600;letter-spacing:.3px;white-space:nowrap;
  margin-left:4px;vertical-align:middle}

/* ── Group detail modal ── */
.grp-modal{width:900px;max-width:96vw;max-height:88vh;padding:0;gap:0;overflow:hidden}
.grp-modal-hd{padding:20px 24px 16px;border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:12px;background:var(--card)}
.grp-modal-hd h3{font-size:15px;font-weight:600;flex:1;margin:0;color:var(--text)}
.grp-modal-sub{font-size:12px;color:var(--dim);white-space:nowrap}
.grp-modal-close{background:none;border:none;color:var(--muted);font-size:22px;
  line-height:1;cursor:pointer;padding:0 2px;transition:color .15s}
.grp-modal-close:hover{color:var(--text)}
.grp-modal-body{overflow-y:auto;padding:16px 20px 24px;flex:1;min-height:0;background:var(--surface)}
.grp-modal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}

/* ── States ── */
.empty{text-align:center;padding:80px 24px;color:var(--dim);font-size:14px}

/* ── Auth / Role UI ── */
.role-badge{padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;letter-spacing:.3px;white-space:nowrap}
.role-badge.admin{background:var(--tint-lavender);color:var(--purple-800);border:1px solid #d4c8f0}
.role-badge.guest{background:var(--tint-peach);color:var(--orange-deep);border:1px solid #e8c9a8}
.btn-logout{padding:5px 12px;border-radius:7px;border:1px solid var(--border2);background:transparent;
  color:var(--slate);font-size:12px;font-weight:500;cursor:pointer;transition:all .15s}
.btn-logout:hover{background:var(--surface);border-color:var(--border2)}

/* ── Guest mode: hide write controls ── */
body.guest-mode #btn-editor,
body.guest-mode #btn-learn,
body.guest-mode #btn-jira,
body.guest-mode .btn-tldr{display:none!important}
body.guest-mode .tag-btn{pointer-events:none;cursor:default;opacity:.78}
body.guest-mode .btn-ungroup,
body.guest-mode .btn-report{display:none!important}

/* ── Editor mode ── */
.btn-editor{background:transparent;color:var(--charcoal)}
.btn-editor:hover{background:var(--surface)}
.btn-editor.active{background:var(--tint-peach);border-color:#e8c9a8;color:var(--orange-deep)}
.card.selected{border-color:var(--primary)!important;box-shadow:rgba(86,69,212,0.15) 0px 0px 0px 3px!important;background:var(--tint-lavender)!important}
.card-check{cursor:pointer;width:15px;height:15px;accent-color:var(--primary);flex-shrink:0}
.editor-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
  background:var(--card);border:1px solid var(--border2);border-radius:12px;
  padding:10px 18px;display:none;align-items:center;gap:12px;z-index:20;
  box-shadow:rgba(15,15,15,0.16) 0px 16px 48px -8px;white-space:nowrap}
.editor-bar.visible{display:flex}
.editor-count{font-size:13px;color:var(--slate)}
.btn-group-sel{padding:7px 16px;border-radius:8px;background:var(--primary);color:#fff;
  border:none;font-size:12px;font-weight:600;cursor:pointer;transition:opacity .15s}
.btn-group-sel:disabled{opacity:.4;cursor:not-allowed}
.btn-clear-sel{padding:7px 12px;border-radius:8px;background:transparent;
  border:1px solid var(--border2);color:var(--slate);font-size:12px;cursor:pointer}
.btn-clear-sel:hover{background:var(--surface)}
.btn-ungroup{padding:2px 10px;border-radius:6px;border:1px solid #f5c6c6;
  background:#fde8e8;color:#c0392b;font-size:11px;font-weight:600;
  cursor:pointer;white-space:nowrap;transition:all .15s}
.btn-ungroup:hover{background:#fbd5d5;border-color:#e8a0a0}
.btn-report{background:transparent;border:1px solid var(--border);color:var(--dim);
  font-size:10px;font-weight:500;cursor:pointer;border-radius:6px;padding:2px 9px;
  transition:all .15s;white-space:nowrap;margin-left:4px}
.btn-report:hover{border-color:var(--orange-deep);color:var(--orange-deep);background:var(--tint-peach)}
.btn-learn{background:var(--primary);border-color:var(--primary);color:#fff;font-weight:600}
.btn-learn:hover{background:var(--primary-pressed);border-color:var(--primary-pressed);color:#fff}
.btn-kb{background:transparent;color:var(--charcoal)}
.btn-kb:hover{background:var(--surface)}
.kb-section{margin-bottom:20px}
.kb-cat-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
  color:var(--muted);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)}
.kb-rule{background:var(--card);border:1px solid var(--border2);border-radius:8px;
  padding:11px 14px;margin-bottom:6px;font-size:13px;line-height:1.55;color:var(--text)}
.modal-textarea{background:var(--card);border:1px solid var(--border2);border-radius:8px;
  color:var(--text);padding:8px 12px;font-size:13px;resize:vertical;font-family:inherit;
  min-height:72px;width:100%;transition:border-color .15s}
.modal-textarea:focus{outline:none;border:2px solid var(--primary)}
.modal-select{background:var(--card);border:1px solid var(--border2);border-radius:8px;
  color:var(--text);padding:8px 12px;font-size:13px;width:100%;cursor:pointer;height:40px}
.modal-select:focus{outline:none;border:2px solid var(--primary)}
</style>
</head>
<body>

<div class="topbar">
  <span class="logo">&#127760; Monopoly World</span>
  <div class="topbar-actions">
    <button class="btn-action btn-editor" id="btn-editor" onclick="toggleEditorMode()">&#x270E; Editor</button>
    <div class="sep-v"></div>
    <button class="btn-action btn-csv" onclick="openModal('csv-modal')">Export CSV</button>
    <button class="btn-action btn-slack" onclick="openModal('slack-modal')">&#x1F4E4; Slack</button>
    <button class="btn-action" id="btn-jira" onclick="openJiraModal()">&#x1F3AB; Jira</button>
    <div class="sep-v"></div>
    <button class="btn-action btn-kb" id="btn-kb" onclick="openKB()">&#x1F4DA; KB</button>
    <button class="btn-action btn-learn" id="btn-learn" onclick="doLearn()">&#x26A1; Learn</button>
    <button class="btn-action btn-tldr" onclick="openModal('tldr-modal')">TL;DR</button>
    <div class="sep-v"></div>
    <span class="role-badge" id="role-badge"></span>
    <button class="btn-logout" onclick="location.href='/logout'">Logout</button>
  </div>
</div>

<div class="filter-bar">
  <div class="filter-left">
    <div class="date-range">
      <input type="date" id="fromDate">
      <span class="range-sep">&#8212;</span>
      <input type="date" id="toDate">
    </div>
    <div class="presets">
      <button class="chip date-chip" id="chip-1" onclick="preset(1)">Today</button>
      <button class="chip date-chip" id="chip-7" onclick="preset(7)">7d</button>
      <button class="chip date-chip active" id="chip-all" onclick="preset(0)">All time</button>
    </div>
    <div class="filter-sep"></div>
    <div class="presets">
      <button class="chip type-chip active" id="chip-type-all" onclick="setTypeFilter(null)">All</button>
      <button class="chip type-chip type-bug" id="chip-type-bug" onclick="setTypeFilter('BUG')">&#x1F41B; Bugs</button>
      <button class="chip type-chip type-fb" id="chip-type-fb" onclick="setTypeFilter('FEEDBACK')">&#x1F4AC; Feedback</button>
    </div>
    <div class="filter-sep"></div>
    <div class="presets">
      <button class="chip tag-filter-btn active" id="chip-tag-all" onclick="setTagFilter(null)">All status</button>
      <button class="chip tag-filter-btn tag-filter-forwarded" onclick="setTagFilter('forwarded')">&#x2197; Forwarded</button>
      <button class="chip tag-filter-btn tag-filter-fixed" onclick="setTagFilter('fixed')">&#x2713; Fixed</button>
      <button class="chip tag-filter-btn tag-filter-none" onclick="setTagFilter('none')">&#x2014; No status</button>
      <button class="chip tag-filter-btn tag-filter-invalid" onclick="setTagFilter('invalid')">&#x2717; Invalid</button>
    </div>
    <div class="filter-sep"></div>
    <div class="presets">
      <button class="chip sentiment-filter-btn active" id="chip-sentiment-all" onclick="setSentimentFilter(null)">All sentiment</button>
      <button class="chip sentiment-filter-btn sentiment-filter-positive" onclick="setSentimentFilter('positive')">&#x1F44D; Positive</button>
      <button class="chip sentiment-filter-btn sentiment-filter-negative" onclick="setSentimentFilter('negative')">&#x1F44E; Negative</button>
    </div>
  </div>
  <div class="stats-row" id="statsRow"></div>
</div>

<!-- CSV modal -->
<div class="overlay" id="csv-modal">
  <div class="modal">
    <h3>Export CSV</h3>
    <p class="modal-note">Eksportuje widoczne wpisy do pliku CSV. Bezpłatne — nie używa OpenAI.</p>
    <div class="modal-fields">
      <div class="modal-row">
        <label>Od<input type="date" id="csv-from"></label>
        <label>Do<input type="date" id="csv-to"></label>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal('csv-modal')">Anuluj</button>
      <button class="btn-primary btn-go-csv" onclick="doExportCSV()">Pobierz CSV</button>
    </div>
  </div>
</div>

<!-- Slack Export modal -->
<div class="overlay" id="slack-modal">
  <div class="modal">
    <h3>&#x1F4E4; Export Slack</h3>
    <p class="modal-note">Eksportuje wpisy oznaczone tagiem <b style="color:#9b6dff">Slack</b> do pliku tekstowego. Podzielone na Feedback i Bugs.</p>
    <div class="modal-fields">
      <div class="modal-row">
        <label>Od<input type="date" id="slack-from"></label>
        <label>Do<input type="date" id="slack-to"></label>
      </div>
    </div>
    <div class="modal-status" id="slack-status" style="font-size:12px;color:var(--muted);min-height:18px"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal('slack-modal')">Anuluj</button>
      <button class="btn-primary" style="background:#9b6dff;color:#fff" onclick="doExportSlack()">Pobierz .txt</button>
    </div>
  </div>
</div>

<!-- Jira Push modal -->
<div class="overlay" id="jira-modal">
  <div class="modal">
    <h3>&#x1F3AB; Push to Jira</h3>
    <p class="modal-note">Tworzy tickety w Jirze dla wpisów oznaczonych tagiem <b style="color:#0055cc">Jira</b>. Wpisy już wysłane zostaną pominięte.</p>
    <div class="modal-warn">&#x26A0;&#xFE0F; Ta operacja tworzy tickety w Jirze — nieodwracalne. Upewnij się, że zaznaczyłeś właściwe wpisy.</div>
    <div class="modal-fields">
      <div class="modal-row">
        <label>Od<input type="date" id="jira-from"></label>
        <label>Do<input type="date" id="jira-to"></label>
      </div>
    </div>
    <div class="modal-status" id="jira-status"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal('jira-modal')">Anuluj</button>
      <button class="btn-primary" id="btn-jira-sync" style="background:#fff;color:#0055cc;border:1px solid #9eb9e8" onclick="doJiraSync()">Sync counts</button>
      <button class="btn-primary" id="btn-jira-push" style="background:#0055cc;color:#fff" onclick="doJiraPush()">Push</button>
    </div>
  </div>
</div>

<!-- TLDR modal -->
<div class="overlay" id="tldr-modal">
  <div class="modal">
    <h3>Generuj TL;DR</h3>
    <div class="modal-warn">⚠️ Ta operacja wysyła dane do OpenAI API i jest płatna. Koszt zależy od liczby wpisów w wybranym przedziale.</div>
    <div class="modal-fields">
      <div class="modal-row">
        <label>Od<input type="date" id="tldr-from"></label>
        <label>Do<input type="date" id="tldr-to"></label>
      </div>
    </div>
    <div class="modal-status" id="tldr-status"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal('tldr-modal')">Anuluj</button>
      <button class="btn-primary btn-go-tldr" id="btn-tldr-start" onclick="doTLDR()">Start</button>
    </div>
  </div>
</div>

<!-- Group detail modal -->
<div class="overlay" id="grp-modal">
  <div class="modal grp-modal">
    <div class="grp-modal-hd">
      <h3 id="grp-title"></h3>
      <span class="grp-modal-sub" id="grp-count"></span>
      <button class="grp-modal-close" onclick="closeModal('grp-modal')">&#x2715;</button>
    </div>
    <div class="grp-modal-body">
      <div class="grp-modal-grid" id="grp-body"></div>
    </div>
  </div>
</div>

<!-- KB modal -->
<div class="overlay" id="kb-modal">
  <div class="modal grp-modal">
    <div class="grp-modal-hd">
      <h3>&#x1F4DA; Knowledge Base</h3>
      <span class="grp-modal-sub" id="kb-count"></span>
      <button class="grp-modal-close" onclick="closeModal('kb-modal')">&#x2715;</button>
    </div>
    <div class="grp-modal-body">
      <div id="kb-body"></div>
    </div>
  </div>
</div>

<!-- Feedback modal -->
<div class="overlay" id="feedback-modal">
  <div class="modal">
    <h3>&#x2691; Report Issue</h3>
    <p class="modal-note">Describe what was wrong with this classification. This helps train future analysis.</p>
    <div class="modal-fields">
      <label>Issue type
        <select class="modal-select" id="fb-issue-type">
          <option value="false_positive">False positive — not game-related content</option>
          <option value="wrong_classification">Wrong type — BUG vs FEEDBACK</option>
          <option value="wrong_grouping">Wrong grouping</option>
          <option value="wrong_summary">Wrong summary or description</option>
        </select>
      </label>
      <label>Reason
        <textarea class="modal-textarea" id="fb-reason" placeholder="Describe what's wrong and what the correct answer should be..."></textarea>
      </label>
    </div>
    <div class="modal-status" id="fb-status"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal('feedback-modal')">Anuluj</button>
      <button class="btn-primary" id="btn-fb-submit" style="background:#e5a827;color:#fff" onclick="submitFeedback()">Submit</button>
    </div>
  </div>
</div>

<div class="editor-bar" id="editor-bar">
  <span class="editor-count" id="editor-count">0 selected</span>
  <button class="btn-group-sel" id="btn-group-sel" onclick="groupSelected()" disabled>Group selected</button>
  <button class="btn-clear-sel" onclick="clearSelection()">Clear selection</button>
</div>

<div class="cards-area">
  <div class="cards-grid" id="grid"></div>
</div>

<script>
const ALL = ${safeEntries};

// ── Role setup (injected by server on each request) ───────────────────────
const ROLE = (typeof window.__role !== 'undefined') ? window.__role : 'guest';
(function applyRole() {
  if (ROLE === 'guest') document.body.classList.add('guest-mode');
  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = ROLE === 'admin' ? 'Admin' : 'Guest';
    badge.className   = 'role-badge ' + ROLE;
  }
})();

let fromDate      = null;
let toDate        = null;
let tagFilter     = null;
let typeFilter    = null;
let sentimentFilter = null;
let editorMode    = false;
let selectedUrls  = new Set();
let feedbackTarget = null;

function toDateStr(d) {
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}

function preset(days) {
  document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('active'));
  const now = new Date();
  if (days === 0) {
    fromDate = null; toDate = null;
    document.getElementById('fromDate').value = '';
    document.getElementById('toDate').value   = '';
    document.getElementById('chip-all').classList.add('active');
  } else {
    const from = new Date(now.getTime() - (days - 1) * 86400000);
    fromDate = toDateStr(from);
    toDate   = toDateStr(now);
    document.getElementById('fromDate').value = fromDate;
    document.getElementById('toDate').value   = toDate;
    const el = document.getElementById('chip-' + days);
    if (el) el.classList.add('active');
  }
  render();
}

document.getElementById('fromDate').addEventListener('change', e => {
  fromDate = e.target.value || null;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  render();
});
document.getElementById('toDate').addEventListener('change', e => {
  toDate = e.target.value || null;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  render();
});

function inRange(entry) {
  if (!fromDate && !toDate) return true;
  const d = entry.date.slice(0, 10);
  if (fromDate && d < fromDate) return false;
  if (toDate   && d > toDate)   return false;
  return true;
}

function e(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function card(r, count, overallCount, inModal) {
  const isBug = r.type === 'BUG';
  const cls   = isBug ? 'bug' : 'fb';
  const oc = (overallCount != null) ? overallCount : count;
  const showOverall = r.groupKey && oc > count;
  const overallBadge = showOverall ? \` <span class="overall-badge">Overall: \${oc}</span>\` : '';
  const countBadge = (count > 1) ? \` <span class="count-badge">×\${count}</span>\${overallBadge}\` : (showOverall ? overallBadge : '');
  const orig = r.messageUrl
    ? \`<a href="\${e(r.messageUrl)}" target="_blank" rel="noopener">&ldquo;\${e(r.originalMessage)}&rdquo; &#8599;</a>\`
    : \`<span>&ldquo;\${e(r.originalMessage)}&rdquo;</span>\`;
  const gk  = r.groupKey   || '';
  const mu  = r.messageUrl || '';
  const fwd = Array.isArray(r.tags) && r.tags.includes('forwarded');
  const fxd = Array.isArray(r.tags) && r.tags.includes('fixed');
  const slk = Array.isArray(r.tags) && r.tags.includes('slack');
  const inv = Array.isArray(r.tags) && r.tags.includes('invalid');
  const pos = Array.isArray(r.tags) && r.tags.includes('positive');
  const neg = Array.isArray(r.tags) && r.tags.includes('negative');
  const jir = Array.isArray(r.tags) && r.tags.includes('jira');
  const grouped    = count > 1 && !!r.groupKey;
  const isSelected = editorMode && !inModal && !!mu && selectedUrls.has(mu);
  let onclk;
  if (inModal) {
    onclk = '';
  } else if (editorMode) {
    onclk = \`onclick="if(!event.target.closest('.tag-btn')&&!event.target.closest('a'))toggleSelect('\${gk}','\${mu}')"\`;
  } else if (grouped) {
    onclk = \`onclick="if(!event.target.closest('a'))showGroup('\${r.groupKey}')"\`;
  } else {
    onclk = '';
  }
  const checkbox   = (editorMode && !inModal) ? \`<input type="checkbox" class="card-check" \${isSelected?'checked':''} onchange="toggleSelect('\${gk}','\${mu}')" onclick="event.stopPropagation()">\` : '';
  const ungroupBtn  = (inModal && mu && gk) ? \`<button class="btn-ungroup" onclick="event.stopPropagation();ungroupEntry('\${mu}')">&#x2715; Remove from group</button>\` : '';
  const reportBtn   = (!inModal && mu) ? \`<button class="btn-report" onclick="event.stopPropagation();openFeedback('\${mu}')" title="Report wrong classification">&#x2691;</button>\` : '';
  return \`<div class="card \${cls}\${grouped ? ' grouped' : ''}\${isSelected ? ' selected' : ''}" \${onclk}>
  <div class="card-banner">
    <span class="banner-type">\${r.type}\${countBadge}</span>
    \${checkbox}
    \${r.jiraKey ? \`<a href="\${e(r.jiraUrl||'#')}" target="_blank" rel="noopener" class="jira-key-badge" onclick="event.stopPropagation()">&#x1F3AB; \${e(r.jiraKey)}</a>\` : ''}
    <span class="banner-meta">@\${e(r.authorUsername)}<br>\${e(r.date)} UTC</span>
  </div>
  <div class="card-body">
    <div class="card-summary">\${e(r.summary)}</div>
    \${r.description ? \`<div class="card-desc">\${e(r.description)}</div>\` : ''}
    <div class="card-orig">\${orig}</div>
  </div>
  <div class="card-tags">
    <button class="tag-btn tag-positive\${pos?' active':''}" data-group="\${gk}" data-url="\${mu}" data-tag="positive" onclick="event.stopPropagation();toggleTag(this,'\${gk}','\${mu}','positive')">&#x1F44D; Positive</button>
    <button class="tag-btn tag-negative\${neg?' active':''}" data-group="\${gk}" data-url="\${mu}" data-tag="negative" onclick="event.stopPropagation();toggleTag(this,'\${gk}','\${mu}','negative')">&#x1F44E; Negative</button>
    <button class="tag-btn tag-forwarded\${fwd?' active':''}" data-group="\${gk}" data-url="\${mu}" data-tag="forwarded" onclick="event.stopPropagation();toggleTag(this,'\${gk}','\${mu}','forwarded')">&#x2197; Forwarded</button>
    <button class="tag-btn tag-fixed\${fxd?' active':''}" data-group="\${gk}" data-url="\${mu}" data-tag="fixed" onclick="event.stopPropagation();toggleTag(this,'\${gk}','\${mu}','fixed')">&#x2713; Fixed</button>
    <button class="tag-btn tag-invalid\${inv?' active':''}" data-group="\${gk}" data-url="\${mu}" data-tag="invalid" onclick="event.stopPropagation();toggleTag(this,'\${gk}','\${mu}','invalid')">&#x2717; Invalid</button>
    \${ungroupBtn}
    <span style="flex:1"></span>
    <button class="tag-btn tag-jira\${jir?' active':''}" data-group="\${gk}" data-url="\${mu}" data-tag="jira" onclick="event.stopPropagation();toggleTag(this,'\${gk}','\${mu}','jira')" title="Oznacz do eksportu Jira">&#x1F3AB; Jira</button>
    <button class="tag-btn tag-slack\${slk?' active':''}" data-group="\${gk}" data-url="\${mu}" data-tag="slack" onclick="event.stopPropagation();toggleTag(this,'\${gk}','\${mu}','slack')" title="Oznacz do eksportu Slack">&#x1F4E4; Slack</button>
    \${reportBtn}
  </div>
</div>\`;
}

function render() {
  const visible = ALL.filter(r => inRange(r) && inTagFilter(r) && inTypeFilter(r) && inSentimentFilter(r));
  const bugs = visible.filter(r => r.type === 'BUG').length;
  const fb   = visible.filter(r => r.type === 'FEEDBACK').length;

  // Overall counts across ALL entries (ignoring timeframe)
  const overallGroupMap = {};
  for (const r of ALL) {
    if (r.groupKey) overallGroupMap[r.groupKey] = (overallGroupMap[r.groupKey] || 0) + 1;
  }

  // Group by groupKey within the current timeframe
  const groupMap = {};
  const groups   = [];
  for (const r of visible) {
    if (r.groupKey) {
      if (groupMap[r.groupKey]) {
        groupMap[r.groupKey].count++;
        if (r.date > groupMap[r.groupKey].rep.date) groupMap[r.groupKey].rep = r;
      } else {
        const g = { rep: r, count: 1 };
        groupMap[r.groupKey] = g;
        groups.push(g);
      }
    } else {
      groups.push({ rep: r, count: 1 });
    }
  }
  groups.sort((a, b) => b.rep.date.localeCompare(a.rep.date));

  const hasGroups = groups.length < visible.length;
  document.getElementById('statsRow').innerHTML =
    \`<div class="stat-chip"><b>\${visible.length}</b>Total</div>\` +
    (hasGroups ? \`<div class="stat-chip"><b>\${groups.length}</b>Groups</div>\` : '') +
    \`<div class="stat-chip"><b style="color:#e74c3c">\${bugs}</b>Bugs</div>\` +
    \`<div class="stat-chip"><b style="color:#27ae60">\${fb}</b>Feedback</div>\`;

  const grid = document.getElementById('grid');
  if (groups.length === 0) {
    grid.innerHTML = '<div class="empty">No entries match the selected date range.</div>';
    return;
  }
  grid.innerHTML = groups.map(g => {
    const overall = g.rep.groupKey ? (overallGroupMap[g.rep.groupKey] || g.count) : g.count;
    return card(g.rep, g.count, overall);
  }).join('');
}

render();

// ── Tag filter ────────────────────────────────────────────────────────────
const STATUS_TAGS = t => t !== 'slack' && t !== 'jira' && t !== 'positive' && t !== 'negative';

function inTagFilter(r) {
  if (!tagFilter) return true;
  if (tagFilter === 'none') {
    const noStatus = !Array.isArray(r.tags) || r.tags.filter(STATUS_TAGS).length === 0;
    if (!r.groupKey) return noStatus;
    return ALL.filter(e => e.groupKey === r.groupKey).every(e => !Array.isArray(e.tags) || e.tags.filter(STATUS_TAGS).length === 0);
  }
  if (Array.isArray(r.tags) && r.tags.includes(tagFilter)) return true;
  if (r.groupKey) return ALL.some(e => e.groupKey === r.groupKey && Array.isArray(e.tags) && e.tags.includes(tagFilter));
  return false;
}

function setTagFilter(tag) {
  tagFilter = tag;
  document.querySelectorAll('.tag-filter-btn').forEach(b => b.classList.remove('active'));
  const btn = tag ? document.querySelector('.tag-filter-' + tag) : document.getElementById('chip-tag-all');
  if (btn) btn.classList.add('active');
  render();
}

function inTypeFilter(r) {
  if (!typeFilter) return true;
  return r.type === typeFilter;
}

function setTypeFilter(type) {
  typeFilter = type;
  document.querySelectorAll('.type-chip').forEach(b => b.classList.remove('active'));
  const btn = type
    ? document.getElementById('chip-type-' + type.toLowerCase())
    : document.getElementById('chip-type-all');
  if (btn) btn.classList.add('active');
  render();
}

function inSentimentFilter(r) {
  if (!sentimentFilter) return true;
  if (Array.isArray(r.tags) && r.tags.includes(sentimentFilter)) return true;
  if (r.groupKey) return ALL.some(e => e.groupKey === r.groupKey && Array.isArray(e.tags) && e.tags.includes(sentimentFilter));
  return false;
}

function setSentimentFilter(s) {
  sentimentFilter = s;
  document.querySelectorAll('.sentiment-filter-btn').forEach(b => b.classList.remove('active'));
  const btn = s
    ? document.querySelector('.sentiment-filter-' + s)
    : document.getElementById('chip-sentiment-all');
  if (btn) btn.classList.add('active');
  render();
}

async function toggleTag(btn, groupKey, messageUrl, tag) {
  const newActive = !btn.classList.contains('active');
  const opposite = tag === 'positive' ? 'negative' : tag === 'negative' ? 'positive' : null;

  const targets = groupKey
    ? ALL.filter(r => r.groupKey === groupKey)
    : ALL.filter(r => r.messageUrl === messageUrl);
  for (const entry of targets) {
    if (!Array.isArray(entry.tags)) entry.tags = [];
    if (newActive) { if (!entry.tags.includes(tag)) entry.tags.push(tag); }
    else           { const i = entry.tags.indexOf(tag); if (i !== -1) entry.tags.splice(i, 1); }
    if (newActive && opposite) {
      const j = entry.tags.indexOf(opposite);
      if (j !== -1) entry.tags.splice(j, 1);
    }
  }

  // Update every matching button in DOM (main grid + open modal)
  const attrSel = groupKey ? \`[data-group="\${groupKey}"]\` : \`[data-url="\${messageUrl}"]\`;
  document.querySelectorAll(\`.tag-btn\${attrSel}[data-tag="\${tag}"]\`)
    .forEach(b => b.classList.toggle('active', newActive));
  if (newActive && opposite) {
    document.querySelectorAll(\`.tag-btn\${attrSel}[data-tag="\${opposite}"]\`)
      .forEach(b => b.classList.remove('active'));
  }

  if (tagFilter || sentimentFilter) render();

  try {
    await fetch('/api/tag', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ groupKey: groupKey||null, messageUrl: messageUrl||null, tag, active: newActive })
    });
  } catch(err) { console.warn('Tag save failed:', err.message); }
}

// ── Group detail ──────────────────────────────────────────────────────────
function showGroup(groupKey) {
  const entries = ALL.filter(r => r.groupKey === groupKey)
    .slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!entries.length) return;
  document.getElementById('grp-title').textContent  = entries[0].groupLabel || groupKey;
  document.getElementById('grp-count').textContent  = entries.length + ' report' + (entries.length !== 1 ? 's' : '');
  document.getElementById('grp-body').innerHTML     = entries.map(r => card(r, 1, null, true)).join('');
  document.getElementById('grp-modal').classList.add('open');
}

// ── Modals ────────────────────────────────────────────────────────────────
function openModal(id) {
  // Pre-fill dates from current filter
  const f = document.getElementById('fromDate').value;
  const t = document.getElementById('toDate').value;
  const prefix = id.startsWith('csv') ? 'csv' : id.startsWith('slack') ? 'slack' : 'tldr';
  document.getElementById(prefix+'-from').value = f;
  document.getElementById(prefix+'-to').value   = t;
  if (id === 'tldr-modal') {
    document.getElementById('tldr-status').textContent = '';
    document.getElementById('btn-tldr-start').disabled = false;
  }
  if (id === 'slack-modal') {
    document.getElementById('slack-status').textContent = '';
  }
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
// Close on overlay click
document.querySelectorAll('.overlay').forEach(el =>
  el.addEventListener('click', e => { if(e.target===el) closeModal(el.id); })
);

// ── CSV Export ────────────────────────────────────────────────────────────
function doExportCSV() {
  const from = document.getElementById('csv-from').value || null;
  const to   = document.getElementById('csv-to').value   || null;

  const rows = ALL.filter(r => {
    const d = r.date.slice(0,10);
    return (!from || d >= from) && (!to || d <= to);
  }).sort((a,b) => b.date.localeCompare(a.date));

  if (rows.length === 0) { alert('Brak wpisów w wybranym przedziale.'); return; }

  const H = ['Date (UTC)','Discord ID','Discord Username','Player ID','Type',
             'Description','Original Message','Message Link','Summary',
             'Steps to Reproduce','Expected Behavior','Actual Behavior','Attachment Notes'];

  const csv = [H.join(','),
    ...rows.map(r => [
      r.date, r.authorId, r.authorUsername, '', r.type,
      r.description, r.originalMessage, r.messageUrl||'',
      r.summary, r.stepsToReproduce, r.expectedBehavior,
      r.actualBehavior, r.attachmentNotes
    ].map(v => \`"\${(v||'').replace(/"/g,'""')}"\`).join(','))
  ].join('\\r\\n');

  const blob = new Blob(['\\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: \`mwo-report-\${from||'all'}-to-\${to||'all'}.csv\`
  });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  closeModal('csv-modal');
}

// ── Slack Export ──────────────────────────────────────────────────────────
function doExportSlack() {
  const from   = document.getElementById('slack-from').value || null;
  const to     = document.getElementById('slack-to').value   || null;
  const status = document.getElementById('slack-status');

  const slackEntries = ALL.filter(r => {
    if (!Array.isArray(r.tags) || !r.tags.includes('slack')) return false;
    const d = r.date.slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  }).sort((a, b) => b.date.localeCompare(a.date));

  if (slackEntries.length === 0) {
    status.style.color = '#e74c3c';
    status.textContent = 'Brak wpisów z tagiem Slack w wybranym przedziale.';
    return;
  }

  function formatEntry(r) {
    const date = r.date || '';
    const link = r.messageUrl || '';
    const user = r.authorUsername ? '@' + r.authorUsername : '';
    const name = r.summary || '';
    const desc = r.description || r.originalMessage || '';
    return \`\${name} - \${desc}; Discord username: \${user}; \${date}; \${link}\`;
  }

  const feedback = slackEntries.filter(r => r.type === 'FEEDBACK');
  const bugs     = slackEntries.filter(r => r.type === 'BUG');

  const lines = [];
  const periodStr = from || to ? \`\${from||'start'} – \${to||'now'}\` : 'All time';
  lines.push(\`Monopoly World – Slack Export\`);
  lines.push(\`Period: \${periodStr}  |  Total: \${slackEntries.length} (Feedback: \${feedback.length}, Bugs: \${bugs.length})\`);
  lines.push('');

  lines.push('=== FEEDBACK ===');
  lines.push('');
  if (feedback.length === 0) {
    lines.push('(no feedback entries)');
  } else {
    feedback.forEach(r => lines.push(formatEntry(r)));
  }
  lines.push('');

  lines.push('=== BUGS ===');
  lines.push('');
  if (bugs.length === 0) {
    lines.push('(no bug entries)');
  } else {
    bugs.forEach(r => lines.push(formatEntry(r)));
  }

  const content  = lines.join('\\r\\n');
  const blob     = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url      = URL.createObjectURL(blob);
  const filename = \`mwo-slack-\${from||'all'}-to-\${to||'all'}.txt\`;
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);

  status.style.color = '#9b6dff';
  status.textContent = \`✓ Pobrano \${slackEntries.length} wpisów.\`;
  setTimeout(() => closeModal('slack-modal'), 1200);
}

// ── Jira Push ─────────────────────────────────────────────────────────────
function openJiraModal() {
  if (!window.__jiraConfigured) {
    alert('Jira nie jest skonfigurowana.\\nDodaj do .env:\\n  JIRA_BASE_URL\\n  JIRA_EMAIL\\n  JIRA_API_TOKEN\\n  JIRA_PROJECT_KEY\\ni zrestartuj serwer.');
    return;
  }
  const f = document.getElementById('fromDate').value;
  const t = document.getElementById('toDate').value;
  document.getElementById('jira-from').value        = f;
  document.getElementById('jira-to').value          = t;
  document.getElementById('jira-status').textContent = '';
  document.getElementById('btn-jira-push').disabled  = false;
  document.getElementById('jira-modal').classList.add('open');
}

async function doJiraPush() {
  const from   = document.getElementById('jira-from').value || null;
  const to     = document.getElementById('jira-to').value   || null;
  const status = document.getElementById('jira-status');
  const btn    = document.getElementById('btn-jira-push');

  btn.disabled = true;
  status.style.color = 'var(--muted)';
  status.textContent = 'Tworzenie ticketów w Jirze...';

  try {
    const res  = await fetch('/api/jira/push', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    const { created, skipped, errors } = data;

    if (created.length === 0 && skipped.length === 0 && errors.length === 0) {
      status.style.color = 'var(--muted)';
      status.textContent = 'Brak wpisów z tagiem Jira w wybranym przedziale.';
      btn.disabled = false;
      return;
    }

    let msg = '';
    if (created.length > 0) msg += \`✓ Utworzono \${created.length} ticket\${created.length > 1 ? 'ów' : ''}: \${created.map(c => c.jiraKey).join(', ')}. \`;
    if (skipped.length > 0) msg += \`Pominięto \${skipped.length} (już w Jirze). \`;
    if (errors.length  > 0) msg += \`Błędy (\${errors.length}): \${errors.map(x => x.error).join('; ')}\`;

    status.style.color = errors.length > 0 ? '#e5a827' : '#27ae60';
    status.textContent = msg;

    if (created.length > 0) {
      setTimeout(() => location.reload(), 2500);
    } else {
      btn.disabled = false;
    }
  } catch (err) {
    status.style.color = '#e74c3c';
    status.textContent = 'Błąd: ' + err.message;
    btn.disabled = false;
  }
}

async function doJiraSync() {
  const status = document.getElementById('jira-status');
  const btn    = document.getElementById('btn-jira-sync');
  btn.disabled = true;
  status.style.color = 'var(--muted)';
  status.textContent = 'Synchronizowanie liczników...';
  try {
    const res  = await fetch('/api/jira/sync-counts', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    const { updated, errors } = data;
    let msg = '';
    if (updated.length > 0) msg += \`✓ Zaktualizowano \${updated.length} ticket\${updated.length > 1 ? 'ów' : ''}. \`;
    if (errors.length  > 0) msg += \`Błędy: \${errors.length}.\`;
    if (updated.length === 0 && errors.length === 0) msg = 'Brak ticketów Jira do synchronizacji.';
    status.style.color = errors.length > 0 ? '#e5a827' : '#27ae60';
    status.textContent = msg;
  } catch (err) {
    status.style.color = '#e74c3c';
    status.textContent = 'Błąd: ' + err.message;
  }
  btn.disabled = false;
}

// ── Editor mode ──────────────────────────────────────────────────────────
function toggleEditorMode() {
  editorMode = !editorMode;
  selectedUrls.clear();
  document.getElementById('btn-editor').classList.toggle('active', editorMode);
  updateEditorBar();
  render();
}

function toggleSelect(groupKey, messageUrl) {
  if (groupKey) {
    const members = ALL.filter(r => r.groupKey === groupKey).map(r => r.messageUrl).filter(Boolean);
    const allSel  = members.length > 0 && members.every(url => selectedUrls.has(url));
    if (allSel) members.forEach(url => selectedUrls.delete(url));
    else        members.forEach(url => selectedUrls.add(url));
  } else if (messageUrl) {
    if (selectedUrls.has(messageUrl)) selectedUrls.delete(messageUrl);
    else selectedUrls.add(messageUrl);
  }
  updateEditorBar();
  render();
}

function updateEditorBar() {
  const bar = document.getElementById('editor-bar');
  bar.classList.toggle('visible', editorMode);
  const n = selectedUrls.size;
  document.getElementById('editor-count').textContent = n + ' selected';
  document.getElementById('btn-group-sel').disabled = n < 2;
}

function clearSelection() {
  selectedUrls.clear();
  updateEditorBar();
  render();
}

async function groupSelected() {
  const directUrls = Array.from(selectedUrls);
  const expanded   = new Set(directUrls);
  for (const url of directUrls) {
    const ent = ALL.find(r => r.messageUrl === url);
    if (ent && ent.groupKey)
      ALL.filter(r => r.groupKey === ent.groupKey).forEach(r => { if (r.messageUrl) expanded.add(r.messageUrl); });
  }
  const urls = Array.from(expanded);
  if (urls.length < 2) return;
  document.getElementById('btn-group-sel').disabled = true;
  try {
    const res  = await fetch('/api/group', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ messageUrls: urls })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    for (const entry of ALL) {
      if (expanded.has(entry.messageUrl)) { entry.groupKey = data.groupKey; entry.groupLabel = data.label; }
    }
    selectedUrls.clear();
    updateEditorBar();
    render();
  } catch(err) {
    alert('Błąd grupowania: ' + err.message);
    updateEditorBar();
  }
}

async function ungroupEntry(messageUrl) {
  try {
    const res = await fetch('/api/ungroup', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ messageUrl })
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const entry = ALL.find(r => r.messageUrl === messageUrl);
    if (entry) { delete entry.groupKey; delete entry.groupLabel; }
    closeModal('grp-modal');
    render();
  } catch(err) {
    alert('Błąd: ' + err.message);
  }
}

// ── TLDR via server ───────────────────────────────────────────────────────
async function doTLDR() {
  const from = document.getElementById('tldr-from').value || null;
  const to   = document.getElementById('tldr-to').value   || null;
  const status = document.getElementById('tldr-status');
  const btn    = document.getElementById('btn-tldr-start');

  btn.disabled = true;
  status.style.color = 'var(--muted)';
  status.textContent = 'Generowanie... może potrwać 30–60 sekund.';

  try {
    const res  = await fetch('/api/tldr', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({from, to})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    // Auto-download the PDF
    const a = Object.assign(document.createElement('a'), {
      href: '/output/tldr/' + data.file,
      download: data.file
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);

    status.style.color = '#27ae60';
    status.innerHTML = \`✓ Pobrano! &nbsp;<a href="/output/tldr/\${data.file}" download style="color:var(--blue);font-size:11px">Pobierz ponownie</a>\`;
  } catch (err) {
    status.style.color = '#e74c3c';
    status.textContent = \`Błąd: \${err.message}\`;
    btn.disabled = false;
  }
}

// ── Feedback / Learn ──────────────────────────────────────────────────────
function openFeedback(messageUrl) {
  feedbackTarget = messageUrl;
  document.getElementById('fb-status').textContent = '';
  document.getElementById('fb-status').style.color = 'var(--muted)';
  document.getElementById('fb-reason').value = '';
  document.getElementById('fb-issue-type').value = 'false_positive';
  document.getElementById('btn-fb-submit').disabled = false;
  document.getElementById('feedback-modal').classList.add('open');
}

async function submitFeedback() {
  const issueType = document.getElementById('fb-issue-type').value;
  const reason    = document.getElementById('fb-reason').value.trim();
  const status    = document.getElementById('fb-status');
  const btn       = document.getElementById('btn-fb-submit');
  if (!reason) { status.style.color = '#e74c3c'; status.textContent = 'Please describe the issue.'; return; }
  btn.disabled = true;
  status.style.color = 'var(--muted)';
  status.textContent = 'Saving...';
  const entry = ALL.find(r => r.messageUrl === feedbackTarget) || null;
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ messageUrl: feedbackTarget, issueType, reason, entrySnapshot: entry })
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    status.style.color = '#27ae60';
    status.textContent = '✓ Saved! Click ⚡ Learn to update the knowledge base.';
    setTimeout(() => closeModal('feedback-modal'), 2500);
  } catch(err) {
    status.style.color = '#e74c3c';
    status.textContent = 'Error: ' + err.message;
    btn.disabled = false;
  }
}

async function openKB() {
  const body  = document.getElementById('kb-body');
  const count = document.getElementById('kb-count');
  body.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px 0">Loading...</div>';
  document.getElementById('kb-modal').classList.add('open');
  try {
    const res  = await fetch('/api/kb');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    const rules = data.rules || [];
    count.textContent = rules.length + ' rule' + (rules.length !== 1 ? 's' : '');
    if (rules.length === 0) {
      body.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px 0">No rules yet. Click &#x2691; on a card and then &#x26A1; Learn to build the knowledge base.</div>';
      return;
    }
    const cats   = { classification: [], relevance: [], grouping: [] };
    const labels = { classification: '&#x1F3F7; Classification', relevance: '&#x1F50D; Relevance', grouping: '&#x1F4E6; Grouping' };
    for (const r of rules) {
      const bucket = cats[r.category] ? r.category : 'classification';
      cats[bucket].push(r);
    }
    let html = '';
    for (const cat of ['classification', 'relevance', 'grouping']) {
      if (cats[cat].length === 0) continue;
      html += '<div class="kb-section">';
      html += '<div class="kb-cat-label">' + labels[cat] + ' (' + cats[cat].length + ')</div>';
      for (const r of cats[cat]) {
        html += '<div class="kb-rule">' + e(r.rule) + '</div>';
      }
      html += '</div>';
    }
    body.innerHTML = html;
  } catch(err) {
    body.innerHTML = '<div style="color:#e74c3c;font-size:13px">Error: ' + err.message + '</div>';
  }
}

async function doLearn() {
  const btn      = document.getElementById('btn-learn');
  const origText = '⚡ Learn';
  btn.disabled   = true;
  btn.textContent = 'Processing...';
  try {
    const res  = await fetch('/api/learn', { method: 'POST', headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    btn.textContent = data.processed === 0
      ? '✓ No pending'
      : '✓ +' + data.newRules + ' rules added';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 3500);
  } catch(err) {
    btn.textContent = origText;
    btn.disabled = false;
    alert('Learn error: ' + err.message);
  }
}
</script>
</body>
</html>`;
}

function generateHTML(rows, runTime) {
  ensureDirs();

  const data = loadData();
  const existing = new Set(data.entries.map(entryKey));

  let added = 0;
  for (const row of rows) {
    if (!existing.has(entryKey(row))) {
      data.entries.push(row);
      existing.add(entryKey(row));
      added++;
    }
  }

  data.lastTimestamp = runTime.toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  db.saveToDb(data).catch(err => console.warn('[db] save failed:', err.message));

  fs.writeFileSync(INDEX_FILE, buildHTML(data.entries), 'utf8');
  console.log(`[${ts()}] +${added} new entries (total: ${data.entries.length}) → ${INDEX_FILE}`);
  return INDEX_FILE;
}

// ── PDF ─────────────────────────────────────────────────────────────────────

async function generatePDF(rows, runTime, periodLabel, tldr) {
  return new Promise((resolve, reject) => {
    ensureDirs();
    const filePath = path.join(TLDR_DIR, `tldr_${runId(runTime)}.pdf`);
    const dateLabel = runTime.toISOString().slice(0, 10);
    const bugs = rows.filter(r => r.type === 'BUG').length;
    const fb   = rows.filter(r => r.type === 'FEEDBACK').length;

    const doc = new PDFDocument({ margin: 52, size: 'A4' });
    const out = fs.createWriteStream(filePath);
    out.on('finish', () => { console.log(`[${ts()}] PDF TL;DR: ${filePath}`); resolve(filePath); });
    out.on('error', reject);
    doc.pipe(out);

    const M = 52;
    const W = doc.page.width - M * 2;

    // ── Dark header banner ────────────────────────────────────────
    doc.fillColor('#111111').rect(0, 0, doc.page.width, 108).fill();
    doc.fontSize(26).font('Helvetica-Bold').fillColor('#ffffff')
       .text('Monopoly World', M, 20, { width: W, align: 'center' });
    doc.fontSize(11).font('Helvetica').fillColor('#aaaaaa')
       .text('Community Report — TL;DR', M, 54, { width: W, align: 'center' });
    doc.fontSize(9).fillColor('#666666')
       .text(`${dateLabel}  ·  ${periodLabel}  ·  ${rows.length} items`, M, 76, { width: W, align: 'center' });

    // ── Stat boxes ────────────────────────────────────────────────
    const statsY = 120;
    const statsH = 54;
    const gap    = 5;
    const col    = W / 3;
    [
      { v: String(rows.length), l: 'TOTAL',    bg: '#1c1c1e', vc: '#ffffff' },
      { v: String(bugs),        l: 'BUGS',     bg: '#2a1212', vc: '#e74c3c' },
      { v: String(fb),          l: 'FEEDBACK', bg: '#0e2218', vc: '#27ae60' },
    ].forEach(({ v, l, bg, vc }, i) => {
      const bx = M + col * i + gap;
      const bw = col - gap * 2;
      doc.fillColor(bg).roundedRect(bx, statsY, bw, statsH, 7).fill();
      doc.fontSize(22).font('Helvetica-Bold').fillColor(vc)
         .text(v, bx, statsY + 9, { width: bw, align: 'center' });
      doc.fontSize(7).font('Helvetica').fillColor('#888888')
         .text(l, bx, statsY + 36, { width: bw, align: 'center' });
    });

    // Reset cursor to left margin below stats
    doc.x = M;
    doc.y = statsY + statsH + 24;

    // ── Helpers ───────────────────────────────────────────────────
    function sectionHeader(title, color) {
      doc.x = M;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(color || '#111111')
         .text(title, M, doc.y, { width: W });
      // Colored underline
      const lineY = doc.y;
      doc.fillColor(color || '#cccccc').rect(M, lineY, W, 1).fill();
      doc.x = M;
      doc.y = lineY + 8;
    }

    function bodyText(text) {
      doc.x = M;
      doc.fontSize(10).font('Helvetica').fillColor('#333333')
         .text(text, M, doc.y, { width: W, lineGap: 3 });
      doc.moveDown(0.9);
    }

    // ── Content ───────────────────────────────────────────────────
    if (tldr.assessment) {
      sectionHeader('Overview', '#333333');
      bodyText(tldr.assessment);
    }

    if (tldr.themes?.length > 0) {
      sectionHeader('Key Bug Themes', '#c0392b');
      for (const t of tldr.themes) {
        doc.x = M;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#222222')
           .text(`• ${t.title}`, M, doc.y, { width: W });
        doc.x = M;
        doc.fontSize(9).font('Helvetica').fillColor('#555555')
           .text(t.detail, M, doc.y, { width: W, indent: 12, lineGap: 2 });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.4);
    }

    if (tldr.feedbackTrend) {
      sectionHeader('Feedback Trends', '#1e8449');
      bodyText(tldr.feedbackTrend);
    }

    if (tldr.actionItems?.length > 0) {
      sectionHeader('Recommended Actions', '#333333');
      doc.moveDown(0.1);
      tldr.actionItems.forEach((item, i) => {
        doc.x = M;
        doc.fontSize(10).font('Helvetica').fillColor('#333333')
           .text(`${i + 1}.  ${item}`, M, doc.y, { width: W, lineGap: 2 });
        doc.moveDown(0.3);
      });
    }

    // ── Footer ────────────────────────────────────────────────────
    doc.fillColor('#eeeeee').rect(0, doc.page.height - 28, doc.page.width, 28).fill();
    doc.fontSize(7).font('Helvetica').fillColor('#999999')
       .text(
         `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC  ·  Monopoly World Community Analyzer`,
         M, doc.page.height - 18, { width: W, align: 'center' }
       );

    doc.end();
  });
}

module.exports = { generateHTML, generatePDF, loadData, loadLastTimestamp };
