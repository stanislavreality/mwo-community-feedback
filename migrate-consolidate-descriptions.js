// One-time migration: consolidate stepsToReproduce / expectedBehavior /
// actualBehavior into description for existing entries in output/reports/data.json.
//
// The new UI shows only summary + description + original quote, so the three
// legacy fields are unused. expected/actual are pure rephrasings of description
// for ~all entries — we just clear them. stepsToReproduce sometimes contains
// real reproduction info (~32/206 entries on the current dataset) — we append
// it to description with a "Reproducible by:" prefix unless already present.
//
// Usage:
//   node migrate-consolidate-descriptions.js            # dry run + sample diffs
//   node migrate-consolidate-descriptions.js --apply    # write changes (also takes its own backup)

const fs   = require('fs');
const path = require('path');

const DATA_FILE = path.resolve('output', 'reports', 'data.json');
const APPLY     = process.argv.includes('--apply');

function pad(n)  { return String(n).padStart(2, '0'); }
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

// Detect whether stepsToReproduce holds real reproduction info versus an
// "N/A" / "unknown" placeholder. The current corpus showed these placeholder
// shapes: "", "unknown", "N/A", "N/A – <comment>".
function hasRealSteps(s) {
  if (!s) return false;
  const t = s.trim();
  if (!t) return false;
  const l = t.toLowerCase();
  if (['n/a', 'na', 'unknown', 'none', '-'].includes(l)) return false;
  if (/^n\/?a\b/i.test(t)) return false;
  return true;
}

function appendSteps(description, steps) {
  const desc = (description || '').trim();
  const stp  = steps.trim();
  if (!desc) return `Reproducible by: ${stp}`;
  if (desc.toLowerCase().includes(stp.toLowerCase())) return desc;
  const sep = /[.!?]$/.test(desc) ? ' ' : '. ';
  return desc + sep + `Reproducible by: ${stp}`;
}

if (!fs.existsSync(DATA_FILE)) {
  console.error(`Data file not found: ${DATA_FILE}`);
  process.exit(1);
}

const data    = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const entries = Array.isArray(data.entries) ? data.entries : [];

let mergedSteps      = 0;
let stepsRedundant   = 0;
let legacyCleared    = 0;
let alreadyEmpty     = 0;
const samples        = [];

for (const r of entries) {
  const hadLegacy = !!(
    (r.stepsToReproduce || '').trim() ||
    (r.expectedBehavior || '').trim() ||
    (r.actualBehavior   || '').trim()
  );

  if (hasRealSteps(r.stepsToReproduce)) {
    const before = r.description || '';
    const after  = appendSteps(before, r.stepsToReproduce);
    if (after !== before) {
      mergedSteps++;
      if (samples.length < 3) {
        samples.push({
          summary: r.summary || '(no summary)',
          before,
          after,
          steps: r.stepsToReproduce,
        });
      }
    } else {
      stepsRedundant++;
    }
    r.description = after;
  }

  if (hadLegacy) legacyCleared++; else alreadyEmpty++;

  r.stepsToReproduce = '';
  r.expectedBehavior = '';
  r.actualBehavior   = '';
}

console.log('=== Migration plan ===');
console.log(`Mode:                       ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'}`);
console.log(`Data file:                  ${DATA_FILE}`);
console.log(`Total entries:              ${entries.length}`);
console.log(`Steps merged into desc:     ${mergedSteps}`);
console.log(`Steps already in desc:      ${stepsRedundant}`);
console.log(`Legacy fields cleared:      ${legacyCleared}`);
console.log(`Untouched (already empty):  ${alreadyEmpty}`);

if (samples.length > 0) {
  console.log('\n=== Sample diffs ===');
  samples.forEach((s, i) => {
    console.log(`\n--- Sample ${i + 1}: ${s.summary} ---`);
    console.log(`BEFORE description:  ${s.before}`);
    console.log(`STEPS were:          ${s.steps}`);
    console.log(`AFTER description:   ${s.after}`);
  });
}

if (!APPLY) {
  console.log('\n=== DRY RUN — no file changes made ===');
  console.log('Re-run with --apply to commit.');
  process.exit(0);
}

const backupPath = path.join(path.dirname(DATA_FILE), `data.backup-premigrate-${stamp()}.json`);
fs.copyFileSync(DATA_FILE, backupPath);
console.log(`\nIn-script backup written:   ${backupPath}`);

fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
console.log(`Migration applied to:       ${DATA_FILE}`);
