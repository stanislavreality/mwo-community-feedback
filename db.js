// Persistent storage backed by Replit DB.
// Survives republish — the local data.json does not.
// On Replit: REPLIT_DB_URL is auto-injected. Locally: module is a no-op.

const DATA_KEY = 'mwo:data';

let client = null;
let initError = null;

function getClient() {
  if (client || initError) return client;
  if (!process.env.REPLIT_DB_URL) {
    initError = new Error('REPLIT_DB_URL not set — running without persistent DB');
    return null;
  }
  try {
    const Database = require('@replit/database');
    client = new Database();
  } catch (err) {
    initError = err;
    console.warn('[db] Replit DB disabled:', err.message);
  }
  return client;
}

function isEnabled() {
  return getClient() !== null;
}

async function loadFromDb() {
  const db = getClient();
  if (!db) return null;
  try {
    const res = await db.get(DATA_KEY);
    // @replit/database v3 returns { ok, value } or { ok: false, error }
    const value = res && typeof res === 'object' && 'ok' in res ? (res.ok ? res.value : null) : res;
    if (!value) return null;
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (err) {
    console.warn('[db] loadFromDb failed:', err.message);
    return null;
  }
}

async function saveToDb(data) {
  const db = getClient();
  if (!db) return false;
  try {
    await db.set(DATA_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('[db] saveToDb failed:', err.message);
    return false;
  }
}

module.exports = { isEnabled, loadFromDb, saveToDb, DATA_KEY };
