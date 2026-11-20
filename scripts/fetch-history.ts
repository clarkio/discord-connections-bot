/**
 * One-off: export a channel's Connections shares to a local JSON file.
 *
 *   BOT_TOKEN=... TARGET_CHANNEL_ID=... bun run history:fetch
 *
 * Optional: HASH_SALT (default random per run; set it to keep player hashes
 * stable across runs), HISTORY_OUT (default data/history.json),
 * HISTORY_LIMIT (max messages to read, default unlimited).
 *
 * The bot needs the Message Content intent enabled and the "Read Message
 * History" permission on the channel. Only salted player hashes, puzzle
 * numbers and guess rows are written; Discord ids, names and free text are not.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Client, GatewayIntentBits, type Message, type TextBasedChannel } from 'discord.js';
import { buildRecords, type RawMessage } from '../src/analysis/history';

const token = process.env.BOT_TOKEN;
const channelId = process.env.TARGET_CHANNEL_ID;
if (!token || !channelId) {
  console.error('BOT_TOKEN and TARGET_CHANNEL_ID are required.');
  process.exit(1);
}
const salt = process.env.HASH_SALT || randomBytes(16).toString('hex');
const out = process.env.HISTORY_OUT || 'data/history.json';
const limit = process.env.HISTORY_LIMIT ? parseInt(process.env.HISTORY_LIMIT, 10) : Infinity;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

async function readAll(channel: TextBasedChannel): Promise<RawMessage[]> {
  const all: RawMessage[] = [];
  let before: string | undefined;
  while (all.length < limit) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (page.size === 0) break;
    for (const m of page.values() as Iterable<Message>) {
      all.push({
        authorId: m.author.id,
        authorIsBot: m.author.bot,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      });
    }
    before = page.last()!.id;
    console.log(`Read ${all.length} messages...`);
  }
  return all;
}

client.once('clientReady', async () => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error('Channel not found or not a text channel.');
    const messages = await readAll(channel);
    const { records, skipped } = buildRecords(messages, salt);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), records }, null, 2));
    console.log(`Wrote ${records.length} shares to ${out}. Skipped:`, skipped);
  } catch (error) {
    console.error('Export failed:', error);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});

await client.login(token);
