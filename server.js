require('dotenv').config();
const express   = require('express');
const basicAuth = require('express-basic-auth');
const path      = require('path');
const fs        = require('fs');

const { generateTLDR, withRetry } = require('./openai');
const { generatePDF }             = require('./report');
const config = require('./config.json');

const app  = express();
const PORT = process.env.PORT || 3000;

const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASS = process.env.DASHBOARD_PASS;

if (!DASHBOARD_PASS) {
  console.warn('[AUTH] DASHBOARD_PASS not set in .env — dashboard is unprotected!');
} else {
  app.use(basicAuth({
    users: { [DASHBOARD_USER]: DASHBOARD_PASS },
    challenge: true,
    realm: 'MWO Community Dashboard',
  }));
  console.log(`[AUTH] Dashboard protected (user: ${DASHBOARD_USER})`);
}

const DATA_FILE  = path.resolve('output', 'reports', 'data.json');
const INDEX_FILE = path.resolve('output', 'reports', 'index.html');

app.use(express.json());
app.use('/output', express.static(path.resolve('output')));

app.get('/', (req, res) => {
  if (!fs.existsSync(INDEX_FILE)) {
    return res.status(404).send('Brak raportu. Uruchom najpierw: node index.js --manual --days 7');
  }
  res.sendFile(INDEX_FILE);
});

app.post('/api/tldr', async (req, res) => {
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

    const model    = config.openaiModel || 'gpt-4o';
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Web UI → http://0.0.0.0:${PORT}`);
});
