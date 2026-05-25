const fs     = require('fs');
const path   = require('path');
const config = require('./config.json');
const { fetchChannelMessages, destroyClient } = require('./discord');
const { analyzeImage, classifyThread, groupEntries, withRetry } = require('./openai');
const { generateHTML, loadData, loadLastTimestamp } = require('./report');

function ts() {
  return new Date().toISOString();
}

const CACHE_DIR        = path.resolve('cache');
const IMAGE_CACHE_FILE = path.join(CACHE_DIR, 'image-descriptions.json');
const SEEN_FILE        = path.join(CACHE_DIR, 'seen-threads.json');

function ensureCache() { fs.mkdirSync(CACHE_DIR, { recursive: true }); }

// ── Image description cache ───────────────────────────────────────────────────
function loadImageCache() {
  try {
    if (fs.existsSync(IMAGE_CACHE_FILE)) return JSON.parse(fs.readFileSync(IMAGE_CACHE_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveImageCache(cache) {
  ensureCache();
  fs.writeFileSync(IMAGE_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

// ── Seen-threads cache (relevant + irrelevant, never re-classify) ─────────────
function loadSeenThreads() {
  try {
    if (fs.existsSync(SEEN_FILE)) return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')));
  } catch {}
  return new Set();
}

function saveSeenThreads(seen) {
  ensureCache();
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2), 'utf8');
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'ogg']);

function classifyAttachment(att) {
  if (att.contentType) {
    if (att.contentType.startsWith('image/')) return 'image';
    if (att.contentType.startsWith('video/')) return 'video';
  }
  const ext = att.name.split('.').pop().toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'other';
}

// Group consecutive messages from the same author into threads.
// A new thread starts when the author changes or the gap exceeds 30 minutes.
function groupIntoThreads(messages) {
  const threads = [];
  let current = null;
  const GAP_MS = 6 * 60 * 60 * 1000;

  for (const msg of messages) {
    if (current && current.authorId === msg.authorId) {
      const lastTs = current.messages[current.messages.length - 1].timestamp.getTime();
      if (msg.timestamp.getTime() - lastTs <= GAP_MS) {
        current.messages.push(msg);
        continue;
      }
    }
    current = {
      authorId: msg.authorId,
      authorUsername: msg.authorUsername,
      channelName: msg.channelName,
      messages: [msg],
    };
    threads.push(current);
  }

  return threads;
}

function formatVisionNote(vision) {
  // Legacy cache entries are plain strings; new entries are parsed JSON objects.
  if (typeof vision === 'string') return `[Image] ${vision}`;
  const screen      = vision.screenContext || 'unknown screen';
  const issue       = vision.visibleIssue  || 'no visible issue';
  const contradicts = vision.contradictsMessage ? 'true' : 'false';
  return `[Image] Screen: ${screen} | Issue: ${issue} | Contradicts message: ${contradicts}`;
}

async function analyzeAttachments(messages, model) {
  const cache = loadImageCache();
  let dirty = false;

  for (const msg of messages) {
    if (msg.attachments.length === 0) continue;

    const notes = [];
    for (const att of msg.attachments) {
      const kind = classifyAttachment(att);

      if (kind === 'image') {
        // Use URL path as stable cache key (strips expiring query tokens)
        let cacheKey;
        try { cacheKey = new URL(att.url).pathname; } catch { cacheKey = att.url; }

        if (cache[cacheKey]) {
          console.log(`[${ts()}] Vision cache hit: ${att.name}`);
          notes.push(formatVisionNote(cache[cacheKey]));
        } else {
          try {
            const vision = await withRetry(() => analyzeImage(att.url, model, msg.content));
            cache[cacheKey] = vision;
            dirty = true;
            notes.push(formatVisionNote(vision));
          } catch (err) {
            console.error(`[${ts()}] Vision error for ${att.url}: ${err.message}`);
            notes.push(`[Image — analysis failed: ${err.message}] URL: ${att.url}`);
          }
        }
      } else if (kind === 'video') {
        notes.push(`[Video attachment — manual review required: ${att.url}]`);
      } else {
        notes.push(`[Attachment: ${att.name} — ${att.url}]`);
      }
    }

    msg.attachmentNotes = notes.join('\n');
  }

  if (dirty) saveImageCache(cache);
}

function buildThreadText(thread) {
  return thread.messages
    .map((m) => {
      let text = m.content.trim();
      if (m.attachmentNotes) {
        text += (text ? '\n' : '') + `[Attachment context: ${m.attachmentNotes}]`;
      }
      return text;
    })
    .filter(Boolean)
    .join('\n---\n');
}

async function analyze(days, incremental = false) {
  const runTime = new Date();
  const model   = config.openaiModel || 'gpt-4o';

  let since;
  if (incremental) {
    const last = loadLastTimestamp();
    since = last ? new Date(last) : new Date(runTime.getTime() - days * 24 * 60 * 60 * 1000);
    console.log(`[${ts()}] === Analysis started (incremental) ===`);
    console.log(`[${ts()}] Since last run: ${since.toISOString()} | Model: ${model}`);
  } else {
    since = new Date(runTime.getTime() - days * 24 * 60 * 60 * 1000);
    console.log(`[${ts()}] === Analysis started (manual) ===`);
    console.log(`[${ts()}] Lookback: ${days} day(s) | Since: ${since.toISOString()} | Model: ${model}`);
  }

  // 1. Fetch messages from every configured channel
  const allMessages = [];
  for (const ch of config.channels) {
    try {
      const msgs = await fetchChannelMessages(ch.id, ch.name, since, process.env.DISCORD_TOKEN);
      allMessages.push(...msgs);
    } catch (err) {
      console.warn(`[${ts()}] Skipping channel "${ch.name}": ${err.message}`);
    }
  }

  // Sort oldest-first so consecutive grouping works correctly
  allMessages.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`[${ts()}] Total messages collected: ${allMessages.length}`);

  if (allMessages.length === 0) {
    generateHTML([], runTime);
    await destroyClient();
    return;
  }

  // 2. Group into author threads
  const threads = groupIntoThreads(allMessages);
  console.log(`[${ts()}] Grouped into ${threads.length} thread(s)`);

  // Filter out threads from ignored users (e.g. team members)
  const ignoredUsers = new Set((config.ignoredUsers || []).map(u => u.toLowerCase()));
  const filteredThreads = ignoredUsers.size > 0
    ? threads.filter(t => !ignoredUsers.has(t.authorUsername.toLowerCase()))
    : threads;
  if (filteredThreads.length < threads.length)
    console.log(`[${ts()}] Skipped ${threads.length - filteredThreads.length} thread(s) from ignored users`);

  // 3. Pre-filter: skip threads already seen (DB entries + irrelevant cache)
  const existingUrls = new Set(
    loadData().entries.map(e => e.messageUrl).filter(Boolean)
  );
  const seen = loadSeenThreads();
  // Seed seen with DB entries so both caches stay in sync
  existingUrls.forEach(u => seen.add(u));

  const newThreads = filteredThreads.filter(t => {
    const firstUrl = t.messages[0].url;
    if (seen.has(firstUrl)) return false;
    if (t.messages.some(m => existingUrls.has(m.url))) return false;
    return true;
  });
  console.log(`[${ts()}] ${newThreads.length} new thread(s) to process (${filteredThreads.length - newThreads.length} already seen — skipped)`);

  if (newThreads.length === 0) {
    generateHTML([], runTime);
    await destroyClient();
    return;
  }

  // 4. Vision analysis only for new threads
  console.log(`[${ts()}] Running vision analysis on attachments...`);
  await analyzeAttachments(newThreads.flatMap(t => t.messages), model);

  // 5. Classify each new thread via OpenAI
  const reportRows = [];
  for (let i = 0; i < newThreads.length; i++) {
    const thread = newThreads[i];
    const threadText = buildThreadText(thread);
    if (!threadText.trim()) continue;

    console.log(`[${ts()}] Classifying thread ${i + 1}/${newThreads.length} (@${thread.authorUsername})...`);

    let classification;
    try {
      classification = await withRetry(() => classifyThread(threadText, model));
    } catch (err) {
      console.error(`[${ts()}] Classification failed for @${thread.authorUsername}: ${err.message}`);
      seen.add(thread.messages[0].url);
      continue;
    }

    // Always mark thread as seen (relevant or not)
    seen.add(thread.messages[0].url);

    if (classification.relevant === false) {
      console.log(`[${ts()}] Skipping @${thread.authorUsername} — not relevant game feedback`);
      continue;
    }

    const firstMsg = thread.messages[0];
    const combinedAttachmentNotes = thread.messages
      .map((m) => m.attachmentNotes)
      .filter(Boolean)
      .join('\n');

    const rawConfidence = (classification.confidence || '').toLowerCase();
    const confidence = ['low', 'medium', 'high'].includes(rawConfidence) ? rawConfidence : 'medium';

    const rawSentiment = (classification.sentiment || '').toLowerCase();
    const sentiment = (rawSentiment === 'positive' || rawSentiment === 'negative') ? rawSentiment : 'negative';

    reportRows.push({
      date: firstMsg.timestamp.toISOString().replace('T', ' ').slice(0, 16),
      authorId: thread.authorId,
      authorUsername: thread.authorUsername,
      messageUrl: firstMsg.url,
      type: classification.type || 'FEEDBACK',
      confidence,
      originalMessage: classification.originalMessage || threadText.slice(0, 1000),
      summary: classification.summary || '',
      description: classification.description || '',
      stepsToReproduce: classification.stepsToReproduce || '',
      expectedBehavior: classification.expectedBehavior || '',
      actualBehavior: classification.actualBehavior || '',
      attachmentNotes: classification.attachmentNotes || combinedAttachmentNotes || '',
      tags: [sentiment],
    });
  }

  saveSeenThreads(seen);
  console.log(`[${ts()}] Produced ${reportRows.length} classified row(s) from ${newThreads.length} new thread(s)`);

  // 6. Group similar entries against existing groups
  if (reportRows.length > 0) {
    const existingEntries = loadData().entries;
    const existingGroupKeys = [...new Map(
      existingEntries
        .filter(e => e.groupKey)
        .map(e => [e.groupKey, { key: e.groupKey, label: e.groupLabel }])
    ).values()];

    console.log(`[${ts()}] Grouping ${reportRows.length} new row(s) (${existingGroupKeys.length} existing group(s))...`);
    try {
      const assignments = await withRetry(() => groupEntries(reportRows, existingGroupKeys, model));
      for (const { index, groupKey, groupLabel } of assignments) {
        if (index >= 0 && index < reportRows.length) {
          reportRows[index].groupKey   = groupKey   || null;
          reportRows[index].groupLabel = groupLabel || null;
        }
      }
      const grouped = reportRows.filter(r => r.groupKey).length;
      console.log(`[${ts()}] Grouping complete — ${grouped} row(s) assigned to a group`);
    } catch (err) {
      console.error(`[${ts()}] Grouping failed: ${err.message} — entries saved ungrouped`);
    }
  }

  // 7. Generate HTML report
  try {
    generateHTML(reportRows, runTime);
  } catch (err) {
    console.error(`[${ts()}] HTML report generation failed: ${err.message}`);
  }

  await destroyClient();

  console.log(`[${ts()}] === Analysis complete ===`);
}

module.exports = { analyze };
