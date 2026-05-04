require('dotenv').config();
const cron = require('node-cron');
const { analyze } = require('./analyzer');
const config = require('./config.json');

function ts() {
  return new Date().toISOString();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const manual      = args.includes('--manual');
  const incremental = args.includes('--incremental');

  const daysIdx = args.indexOf('--days');
  let days;
  if (daysIdx !== -1) {
    days = parseInt(args[daysIdx + 1], 10);
    if (isNaN(days) || days < 1) {
      console.error('--days must be a positive integer (e.g. --days 7)');
      process.exit(1);
    }
  } else {
    days = config.lookbackDays;
  }

  return { manual, incremental, days };
}

function validateEnv() {
  const required = ['DISCORD_TOKEN', 'OPENAI_API_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

async function main() {
  validateEnv();

  const { manual, incremental, days } = parseArgs();

  if (manual) {
    if (incremental) {
      console.log(`[${ts()}] Manual mode — incremental (from last run in DB)`);
    } else {
      console.log(`[${ts()}] Manual mode — last ${days} day(s)`);
    }
    try {
      await analyze(days, incremental);
    } catch (err) {
      console.error(`[${ts()}] Fatal error:`, err);
      process.exit(1);
    }
    process.exit(0);
  }

  // Scheduled mode
  const { cron: cronExpr, timezone } = config.schedule;

  if (!cron.validate(cronExpr)) {
    console.error(`Invalid cron expression in config.json: "${cronExpr}"`);
    process.exit(1);
  }

  console.log(`[${ts()}] Scheduled mode — cron: "${cronExpr}" (${timezone})`);
  console.log(`[${ts()}] Lookback: ${config.lookbackDays} day(s) per run`);
  console.log(`[${ts()}] Watching ${config.channels.length} channel(s): ${config.channels.map((c) => '#' + c.name).join(', ')}`);

  cron.schedule(
    cronExpr,
    async () => {
      console.log(`[${ts()}] Scheduled run triggered`);
      try {
        await analyze(config.lookbackDays, true);
      } catch (err) {
        console.error(`[${ts()}] Scheduled run error:`, err);
      }
    },
    { timezone }
  );

  require('./server');
  console.log(`[${ts()}] Scheduler active. Waiting for next run...`);

  const { destroyClient } = require('./discord');
  process.on('SIGINT',  () => { console.log('\n[SHUTDOWN] Ctrl+C — disconnecting...'); destroyClient().finally(() => process.exit(0)); });
  process.on('SIGTERM', () => { console.log('\n[SHUTDOWN] SIGTERM — disconnecting...');  destroyClient().finally(() => process.exit(0)); });
}

main();
