import { Client, GatewayIntentBits, type Message } from 'discord.js';
import { TursoDatabase } from './db/turso';
import { handleMessage, parseIgnoredUserIds, type ChatMessage, type HandlerContext } from './handler';

const token = process.env.BOT_TOKEN;
const targetChannelId = process.env.TARGET_CHANNEL_ID;
if (!token || !targetChannelId) {
  console.error('BOT_TOKEN and TARGET_CHANNEL_ID are required.');
  process.exit(1);
}

// Locally this falls back to a file database; on Railway set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
const db = TursoDatabase.connect(process.env.TURSO_DATABASE_URL ?? 'file:./localDb/local.db', process.env.TURSO_AUTH_TOKEN);
await db.migrate();

const ctx: HandlerContext = {
  db,
  ignoredIds: parseIgnoredUserIds(process.env.IGNORED_USER_IDS),
  taggingEnabled: process.env.USER_TAGGING_ENABLED === 'true',
  targetChannelId,
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

function toChatMessage(m: Message): ChatMessage {
  return {
    author: { id: m.author.id, username: m.author.username, bot: m.author.bot },
    content: m.content,
    channelId: m.channelId,
    createdAt: m.createdAt,
    react: async (emoji) => {
      await m.react(emoji);
    },
    channel: {
      send: async (text) => {
        if (m.channel.isSendable()) await m.channel.send(text);
      },
    },
  };
}

client.once('clientReady', () => console.log(`Logged in as ${client.user?.tag}!`));
client.on('messageCreate', (m) => {
  handleMessage(toChatMessage(m), ctx).catch((error) => console.error('Unhandled message error:', error));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await client.destroy();
    db.close();
    process.exit(0);
  });
}

await client.login(token);
