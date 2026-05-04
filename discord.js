const { Client, GatewayIntentBits, Partials } = require('discord.js');

let client = null;

function ts() {
  return new Date().toISOString();
}

async function getClient(token) {
  if (client && client.isReady()) return client;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.login(token);
  });

  console.log(`[${ts()}] Discord: logged in as ${client.user.tag}`);
  return client;
}

async function fetchChannelMessages(channelId, channelName, since, token) {
  const discord = await getClient(token);

  let channel;
  try {
    channel = await discord.channels.fetch(channelId);
  } catch (err) {
    console.warn(`[${ts()}] WARNING: Cannot access channel "${channelName}" (${channelId}): ${err.message}`);
    return [];
  }

  if (!channel || !channel.isTextBased || !channel.isTextBased()) {
    console.warn(`[${ts()}] WARNING: Channel "${channelName}" (${channelId}) is not text-based, skipping.`);
    return [];
  }

  if (!('messages' in channel)) {
    console.warn(`[${ts()}] WARNING: Channel "${channelName}" (${channelId}) does not support messages, skipping.`);
    return [];
  }

  console.log(`[${ts()}] Fetching messages from #${channelName} since ${since.toISOString()}`);

  const sinceMs = since.getTime();
  const collected = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;

    const sorted = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    let reachedWindow = false;
    for (const msg of sorted) {
      if (msg.createdTimestamp < sinceMs) {
        reachedWindow = true;
        break;
      }

      if (msg.author.bot) continue;
      if (!hasMeaningfulContent(msg)) continue;

      collected.push(normalizeMessage(msg, channelName));
    }

    if (reachedWindow) break;

    const oldest = sorted[sorted.length - 1];
    before = oldest.id;
  }

  console.log(`[${ts()}] Collected ${collected.length} meaningful messages from #${channelName}`);
  return collected;
}

function hasMeaningfulContent(msg) {
  const hasAttachments = msg.attachments.size > 0;
  if (hasAttachments) return true;

  const content = msg.content.trim();
  if (!content) return false;

  // Strip Discord custom emoji <:name:id> and <a:name:id>
  let stripped = content.replace(/<a?:\w+:\d+>/g, '');
  // Strip standard unicode emoji blocks
  stripped = stripped.replace(/\p{Emoji_Presentation}/gu, '');
  stripped = stripped.trim();
  if (!stripped) return false;

  // Bare URL with no surrounding words means no context
  const withoutUrls = stripped.replace(/https?:\/\/\S+/g, '').trim();
  if (!withoutUrls) return false;

  return true;
}

function normalizeMessage(msg, channelName) {
  const attachments = [...msg.attachments.values()].map((a) => ({
    url: a.url,
    contentType: a.contentType || '',
    name: a.name || '',
  }));

  return {
    id: msg.id,
    channelName,
    authorId: msg.author.id,
    authorUsername: msg.author.username,
    content: msg.content,
    timestamp: new Date(msg.createdTimestamp),
    attachments,
    attachmentNotes: '',
    url: msg.url,
  };
}

async function destroyClient() {
  if (client) {
    client.destroy();
    client = null;
    console.log(`[${ts()}] Discord client disconnected.`);
  }
}

module.exports = { fetchChannelMessages, destroyClient };
