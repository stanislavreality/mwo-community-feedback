// One-time migration: group all existing entries in data.json by root issue.
// Run with: npm run regroup
require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const config = require('./config.json');
const { groupEntries, withRetry } = require('./openai');
const { loadData, generateHTML }  = require('./report');

const DATA_FILE = path.resolve('output', 'reports', 'data.json');
const MODEL     = config.openaiModel || 'gpt-4o';

function ts() { return new Date().toISOString(); }

async function main() {
  const data    = loadData();
  const entries = data.entries;

  if (entries.length === 0) {
    console.log('No entries to group.');
    return;
  }

  // Reset group keys for a clean run
  for (const e of entries) {
    e.groupKey   = null;
    e.groupLabel = null;
  }

  console.log(`[${ts()}] Sending all ${entries.length} entries in one call (model: ${MODEL})...`);

  // maxTokens: ~30 tokens per assignment × entries + overhead
  const maxTokens = Math.max(3000, entries.length * 35);

  let assignments;
  try {
    assignments = await withRetry(() => groupEntries(entries, [], MODEL, maxTokens));
  } catch (err) {
    console.error(`[${ts()}] Grouping call failed: ${err.message}`);
    process.exit(1);
  }

  for (const { index, groupKey, groupLabel } of assignments) {
    if (index >= 0 && index < entries.length) {
      entries[index].groupKey   = groupKey   || null;
      entries[index].groupLabel = groupLabel || null;
    }
  }

  // Write updated data.json
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[${ts()}] data.json saved`);

  // Regenerate HTML from updated data
  generateHTML([], new Date());

  const totalGrouped = entries.filter(e => e.groupKey).length;
  const uniqueGroups = new Set(entries.map(e => e.groupKey).filter(Boolean)).size;

  console.log(`[${ts()}] Done — ${totalGrouped}/${entries.length} entries grouped into ${uniqueGroups} group(s)`);
  console.log('');
  console.log('Groups summary:');

  const byGroup = {};
  for (const e of entries) {
    if (!e.groupKey) continue;
    if (!byGroup[e.groupKey]) byGroup[e.groupKey] = { label: e.groupLabel, count: 0 };
    byGroup[e.groupKey].count++;
  }
  for (const [key, { label, count }] of Object.entries(byGroup).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${count}x [${key}] — ${label}`);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
