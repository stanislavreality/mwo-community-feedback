# MWO Discord Channel Analyzer

Automatically fetches Discord messages from configured channels, classifies them as **BUG** or **FEEDBACK** using GPT-4o (with vision for screenshots), and serves a live web dashboard with date filtering, CSV export, and on-demand TL;DR PDF generation.

---

## Project Structure

```
├── index.js        — Entry point: CLI args + cron scheduler + web server
├── analyzer.js     — Pipeline: fetch → vision → classify → save
├── discord.js      — Discord message fetching
├── openai.js       — GPT-4o classification, vision, TL;DR generation
├── report.js       — HTML dashboard builder + PDF generator + data store
├── server.js       — Express web server (UI + /api/tldr endpoint)
├── config.json     — Channel IDs, schedule, model settings
├── .env            — Secrets (never commit)
├── .env.example    — Template for secrets
└── output/
    ├── reports/
    │   ├── data.json    — Accumulated entries (the database)
    │   └── index.html   — Live dashboard (rebuilt on each run)
    └── tldr/
        └── tldr_*.pdf   — Generated TL;DR reports
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. **Bot** → **Reset Token** → copy the token
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. **OAuth2 → URL Generator**: scopes `bot`, permissions `Read Messages` + `Read Message History`
5. Open the generated URL and add the bot to your server
6. Right-click any channel (Developer Mode on in Settings → Advanced) → **Copy Channel ID**

### 3. OpenAI API Key

Get a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). Requires access to `gpt-4o`.

### 4. Configure

Copy `.env.example` to `.env` and fill in:

```
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key
PORT=3000
```

Edit `config.json`:

```json
{
  "channels": [
    { "id": "YOUR_CHANNEL_ID", "name": "bug-reports" },
    { "id": "YOUR_CHANNEL_ID", "name": "feedback" }
  ],
  "schedule": {
    "cron": "0 8 * * *",
    "timezone": "Europe/Warsaw"
  },
  "lookbackDays": 1,
  "openaiModel": "gpt-4o"
}
```

| Field | Description |
|-------|-------------|
| `channels` | Discord channels to monitor |
| `schedule.cron` | When to run automatically (`0 8 * * *` = 08:00 daily) |
| `schedule.timezone` | Cron timezone (e.g. `Europe/Warsaw`, `UTC`) |
| `lookbackDays` | Fallback lookback if no prior run in DB |
| `openaiModel` | OpenAI model — must support vision |

---

## Running

### Scheduled mode (default)

Starts the cron scheduler **and** the web server in one process:

```bash
node index.js
```

Dashboard at `http://localhost:3000`. Analysis fires automatically at 08:00 Warsaw time.

### Manual — backfill N days

```bash
node index.js --manual --days 7
```

Fetches and classifies the last N days. New entries are deduplicated against existing data.

### Manual — incremental (from last run)

```bash
node index.js --manual --incremental
```

Fetches only what's new since the last recorded entry in `data.json`. Most efficient for catch-up runs.

---

## Web Dashboard

Open `http://localhost:3000` (or your Replit URL):

- **Date range picker** — filter entries by date with quick presets (Today, 7d, 30d, All)
- **Export CSV** — downloads a CSV of the current filter. Free, no API calls.
- **Make TL;DR (Płatne)** — generates a PDF executive summary via OpenAI. Requires the server to be running. PDF saved to `output/tldr/`.

---

## Deploying to Replit

This app needs a persistent filesystem (`output/reports/data.json` is the database) and an always-running process (in-process `node-cron` fires at 08:00). Use **Reserved VM Deployment**, not Autoscale / Cloud Run.

1. **Import the project** — Create a new Repl from this Git repo (or upload the folder). `.replit` is already configured for `nodejs-20` + VM deployment.
2. **Add Secrets** (Tools → Secrets) — minimum required:
   - `DISCORD_TOKEN`
   - `OPENAI_API_KEY`
   - `DASHBOARD_PASS` (login password for the dashboard)
   - `SESSION_SECRET` (any long random string)

   Optional — only if you want the Jira button in the dashboard:
   - `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`
   - `JIRA_FIELD_*` custom field IDs (run `node get-jira-fields.js` to list them)
   - `DASHBOARD_URL` (the public URL of your Replit deployment)
3. **Seed the data** — `output/` and `cache/` are gitignored, so the Repl starts empty. Either:
   - Run a one-off backfill in the Shell: `node index.js --manual --days 30`, **or**
   - Upload your existing `output/reports/data.json` and `cache/*.json` via the Files panel.
4. **Deploy** — Click **Deploy → Reserved VM Deployment**. The `.replit` file already sets `deploymentTarget = "vm"` and maps `localPort 3000 → externalPort 80`, so the dashboard will be served at the deployment's public URL.
5. **Verify** — Open the deployment URL, log in with `DASHBOARD_PASS`, and confirm the dashboard renders. The cron fires daily at 08:00 Europe/Warsaw (see `config.json`).

**Why not Autoscale / Cloud Run?** Those targets have an ephemeral filesystem (the database vanishes on restart) and scale instances to zero (the cron never fires). Reserved VM keeps a single instance running with persistent disk — the only model this app works on.

---

## How It Works

1. **Fetch** — Messages in the time window are fetched per channel. Bot messages, empty content, emoji-only, and bare links are filtered out.
2. **Group** — Consecutive messages from the same author within 30 minutes are merged into one thread.
3. **Vision** — Image attachments are described by GPT-4o. Videos are flagged for manual review.
4. **Classify** — Each thread is sent to GPT-4o. Off-topic chit-chat is marked `relevant: false` and skipped. Valid entries get `BUG` or `FEEDBACK` with full structured output.
5. **Deduplicate & Save** — New entries are compared against `data.json` by Discord message URL and appended if not already present.
6. **Rebuild** — `output/reports/index.html` is regenerated with all accumulated data.
