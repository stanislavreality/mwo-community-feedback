// Run: node get-jira-fields.js
// Lists all custom field IDs from your Jira instance.
// Copy the relevant IDs into .env as JIRA_FIELD_* variables.
require('dotenv').config();
const { listFields } = require('./jira');

(async () => {
  try {
    const fields = await listFields();
    const custom = fields.filter(f => f.custom).sort((a, b) => a.name.localeCompare(b.name));

    console.log('\nCustom fields in your Jira instance:\n');
    console.log('Field ID'.padEnd(32) + 'Name');
    console.log('-'.repeat(72));
    for (const f of custom) {
      console.log(f.id.padEnd(32) + f.name);
    }

    console.log('\n--- Add to .env ---');
    console.log('# Map each field name to the matching ID above');
    console.log('JIRA_FIELD_REPORT_TYPE=customfield_XXXXX     # "Report Type"');
    console.log('JIRA_FIELD_SENTIMENT=customfield_XXXXX       # "Sentiment"');
    console.log('JIRA_FIELD_DISCORD_USERNAME=customfield_XXXXX # "Discord Username"');
    console.log('JIRA_FIELD_PLAYER_ID=customfield_XXXXX       # "Player ID"');
    console.log('JIRA_FIELD_SIMILAR_COUNT=customfield_XXXXX   # "Similar Reports Count"');
  } catch (err) {
    console.error('\nError:', err.message);
    console.error('Make sure JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN are set in .env');
    process.exit(1);
  }
})();
