const fs   = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

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
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#141414;--surface:#1c1c1e;--card:#1e1e20;--card-h:#252528;
  --border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.13);
  --text:#e8e8e8;--muted:#777;--dim:#444;
  --bug:#e74c3c;--fb:#27ae60;--blue:#4a9eff;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column}

/* ── Topbar ── */
.topbar{background:var(--surface);border-bottom:1px solid var(--border);
  padding:0 24px;height:52px;display:flex;align-items:center;gap:14px;flex-shrink:0;position:sticky;top:0;z-index:10}
.logo{font-size:15px;font-weight:700;letter-spacing:-.3px;white-space:nowrap}
.sep{width:1px;height:18px;background:var(--border2)}
.topbar-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1}

/* ── Date filter ── */
.date-range{display:flex;align-items:center;gap:6px;font-size:13px}
input[type="date"]{
  background:var(--card);border:1px solid var(--border2);border-radius:6px;
  color:var(--text);padding:5px 9px;font-size:12px;cursor:pointer;
  color-scheme:dark}
input[type="date"]:focus{outline:none;border-color:var(--blue)}
.range-sep{color:var(--muted);font-size:12px}

/* ── Preset chips ── */
.presets{display:flex;gap:6px;flex-wrap:wrap}
.chip{padding:5px 12px;border-radius:20px;border:1px solid var(--border2);
  background:transparent;color:var(--muted);font-size:12px;cursor:pointer;
  transition:all .15s;white-space:nowrap}
.chip:hover{border-color:var(--blue);color:var(--blue)}
.chip.active{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:600}

/* ── Stats chips ── */
.stats-row{display:flex;gap:8px;flex-wrap:wrap}
.stat-chip{background:rgba(255,255,255,.05);border:1px solid var(--border);
  border-radius:6px;padding:4px 12px;font-size:12px;white-space:nowrap}
.stat-chip b{font-size:15px;font-weight:800;margin-right:4px}

/* ── Action buttons ── */
.actions{display:flex;gap:8px;margin-left:auto}
.btn-action{padding:6px 13px;border-radius:7px;font-size:12px;font-weight:600;
  cursor:pointer;border:1px solid var(--border2);transition:all .15s;white-space:nowrap}
.btn-csv{background:rgba(39,174,96,.15);color:#27ae60}
.btn-csv:hover{background:rgba(39,174,96,.28)}
.btn-tldr{background:rgba(74,158,255,.15);color:var(--blue)}
.btn-tldr:hover{background:rgba(74,158,255,.28)}

/* ── Modals ── */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:none;
  align-items:center;justify-content:center;z-index:100}
.overlay.open{display:flex}
.modal{background:#1c1c1e;border:1px solid rgba(255,255,255,.12);border-radius:14px;
  padding:28px;width:400px;max-width:92vw;display:flex;flex-direction:column;gap:18px}
.modal h3{font-size:16px;font-weight:700}
.modal-note{font-size:12px;color:var(--muted);line-height:1.5}
.modal-warn{font-size:12px;color:#e5a827;background:rgba(229,168,39,.1);
  border:1px solid rgba(229,168,39,.25);border-radius:8px;padding:10px 14px;line-height:1.5}
.modal-fields{display:flex;flex-direction:column;gap:10px}
.modal-fields label{font-size:11px;font-weight:600;color:var(--muted);
  text-transform:uppercase;letter-spacing:.5px;display:flex;flex-direction:column;gap:5px}
.modal-row{display:flex;gap:10px}
.modal-row label{flex:1}
.modal-actions{display:flex;gap:10px;justify-content:flex-end}
.btn-cancel{padding:8px 16px;border-radius:7px;border:1px solid var(--border2);
  background:transparent;color:var(--muted);font-size:13px;cursor:pointer}
.btn-cancel:hover{color:var(--text)}
.btn-primary{padding:8px 18px;border-radius:7px;border:none;font-size:13px;
  font-weight:700;cursor:pointer;transition:opacity .15s}
.btn-primary:disabled{opacity:.45;cursor:not-allowed}
.btn-go-csv{background:#27ae60;color:#fff}
.btn-go-tldr{background:var(--blue);color:#fff}
.modal-status{font-size:12px;color:var(--muted);min-height:18px}

/* ── Cards ── */
.cards-area{flex:1;padding:20px 24px}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.card{background:var(--card);border:1px dashed var(--border2);border-radius:10px;
  overflow:hidden;transition:border-color .15s,background .15s}
.card:hover{background:var(--card-h);border-color:rgba(255,255,255,.2)}
.card-banner{padding:9px 14px;display:flex;align-items:center;justify-content:space-between}
.card.bug .card-banner{background:rgba(231,76,60,.13)}
.card.fb  .card-banner{background:rgba(39,174,96,.10)}
.banner-type{font-size:10px;font-weight:800;letter-spacing:.8px;text-transform:uppercase}
.card.bug .banner-type{color:#e74c3c}
.card.fb  .banner-type{color:#27ae60}
.banner-meta{font-size:10px;color:var(--muted);text-align:right}
.card-body{padding:14px;display:flex;flex-direction:column;gap:9px}
.card-summary{font-size:14px;font-weight:700;line-height:1.4}
.card-desc{font-size:12px;color:#aaa;line-height:1.6}
.fields{display:flex;flex-direction:column;gap:5px}
.frow{display:grid;grid-template-columns:68px 1fr;gap:6px;font-size:11px}
.flabel{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);padding-top:1px}
.fval{color:#bbb;line-height:1.45}
.card-orig{border-top:1px solid var(--border);padding-top:9px}
.card-orig a,.card-orig span{font-size:11px;font-style:italic;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-orig a{color:#5b82b4;text-decoration:none}
.card-orig a:hover{color:var(--blue);text-decoration:underline}
.card-orig span{color:var(--dim)}

/* ── States ── */
.empty{text-align:center;padding:80px 24px;color:var(--muted);font-size:14px}
</style>
</head>
<body>

<div class="topbar">
  <span class="logo">&#127760; Monopoly World</span>
  <div class="sep"></div>
  <div class="topbar-right">
    <div class="date-range">
      <input type="date" id="fromDate">
      <span class="range-sep">&#8212;</span>
      <input type="date" id="toDate">
    </div>
    <div class="presets">
      <button class="chip" onclick="preset(1)">Today</button>
      <button class="chip" onclick="preset(7)">7 days</button>
      <button class="chip" onclick="preset(30)">30 days</button>
      <button class="chip active" id="chip-all" onclick="preset(0)">All time</button>
    </div>
    <div class="stats-row" id="statsRow"></div>
    <div class="sep"></div>
    <div class="actions">
      <button class="btn-action btn-csv"  onclick="openModal('csv-modal')">Export CSV</button>
      <button class="btn-action btn-tldr" onclick="openModal('tldr-modal')">Make TL;DR <span style="font-size:10px;opacity:.7">(Płatne)</span></button>
    </div>
  </div>
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

<div class="cards-area">
  <div class="cards-grid" id="grid"></div>
</div>

<script>
const ALL = ${safeEntries};

let fromDate = null;
let toDate   = null;

function toDateStr(d) {
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}

function preset(days) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
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

function card(r) {
  const isBug = r.type === 'BUG';
  const cls   = isBug ? 'bug' : 'fb';
  const fields = [
    r.stepsToReproduce && r.stepsToReproduce !== 'unknown'
      ? \`<div class="frow"><span class="flabel">Steps</span><span class="fval">\${e(r.stepsToReproduce)}</span></div>\` : '',
    r.expectedBehavior
      ? \`<div class="frow"><span class="flabel">Expected</span><span class="fval">\${e(r.expectedBehavior)}</span></div>\` : '',
    r.actualBehavior
      ? \`<div class="frow"><span class="flabel">Actual</span><span class="fval">\${e(r.actualBehavior)}</span></div>\` : '',
  ].filter(Boolean).join('');
  const orig = r.messageUrl
    ? \`<a href="\${e(r.messageUrl)}" target="_blank" rel="noopener">&ldquo;\${e(r.originalMessage)}&rdquo; &#8599;</a>\`
    : \`<span>&ldquo;\${e(r.originalMessage)}&rdquo;</span>\`;
  return \`<div class="card \${cls}">
  <div class="card-banner">
    <span class="banner-type">\${r.type}</span>
    <span class="banner-meta">@\${e(r.authorUsername)}<br>\${e(r.date)} UTC</span>
  </div>
  <div class="card-body">
    <div class="card-summary">\${e(r.summary)}</div>
    \${r.description ? \`<div class="card-desc">\${e(r.description)}</div>\` : ''}
    \${fields ? \`<div class="fields">\${fields}</div>\` : ''}
    <div class="card-orig">\${orig}</div>
  </div>
</div>\`;
}

function render() {
  const visible = ALL.filter(inRange);
  const bugs = visible.filter(r => r.type === 'BUG').length;
  const fb   = visible.filter(r => r.type === 'FEEDBACK').length;

  document.getElementById('statsRow').innerHTML =
    \`<div class="stat-chip"><b>\${visible.length}</b>Total</div>\` +
    \`<div class="stat-chip"><b style="color:#e74c3c">\${bugs}</b>Bugs</div>\` +
    \`<div class="stat-chip"><b style="color:#27ae60">\${fb}</b>Feedback</div>\`;

  const grid = document.getElementById('grid');
  if (visible.length === 0) {
    grid.innerHTML = '<div class="empty">No entries match the selected date range.</div>';
    return;
  }
  grid.innerHTML = visible
    .slice()
    .sort((a,b) => b.date.localeCompare(a.date))
    .map(card).join('');
}

render();

// ── Modals ────────────────────────────────────────────────────────────────
function openModal(id) {
  // Pre-fill dates from current filter
  const f = document.getElementById('fromDate').value;
  const t = document.getElementById('toDate').value;
  const prefix = id.startsWith('csv') ? 'csv' : 'tldr';
  document.getElementById(prefix+'-from').value = f;
  document.getElementById(prefix+'-to').value   = t;
  if (id === 'tldr-modal') {
    document.getElementById('tldr-status').textContent = '';
    document.getElementById('btn-tldr-start').disabled = false;
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
