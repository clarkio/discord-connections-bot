/**
 * One-off: load a channel's past Connections shares into the Turso database.
 *
 *   BOT_TOKEN=... TARGET_CHANNEL_ID=... TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
 *     bun run history:backfill            # dry run: reports what it would do, writes nothing
 *   ... bun run history:backfill --apply  # writes to the database
 *
 * Optional: IGNORED_USER_IDS (same as the bot; ignored players are stored but never win or tie),
 * HISTORY_LIMIT (max messages to read).
 *
 * Safe to repeat and safe alongside the running bot: the first share per player and puzzle counts,
 * results already in the database are never overwritten, and nothing is announced in the channel.
 * Unlike history:fetch, this keeps real Discord ids and names, because the database needs them.
 */
import { Client, GatewayIntentBits, type Message, type TextBasedChannel } from 'discord.js';
import { backfillHistory, formatInvalidShares, type BackfillMessage } from '../src/backfill';
import { TursoDatabase } from '../src/db/turso';
import { parseIgnoredUserIds } from '../src/handler';

const token = process.env.BOT_TOKEN;
const channelId = process.env.TARGET_CHANNEL_ID;
const dbUrl = process.env.TURSO_DATABASE_URL;
if (!token || !channelId || !dbUrl) {
  console.error('BOT_TOKEN, TARGET_CHANNEL_ID and TURSO_DATABASE_URL are required (no local fallback: this must hit the real database).');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const limit = process.env.HISTORY_LIMIT ? parseInt(process.env.HISTORY_LIMIT, 10) : Infinity;
const ignoredIds = parseIgnoredUserIds(process.env.IGNORED_USER_IDS);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

async function readAll(channel: TextBasedChannel): Promise<BackfillMessage[]> {
  const all: BackfillMessage[] = [];
  let before: string | undefined;
  while (all.length < limit) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (page.size === 0) break;
    for (const m of page.values() as Iterable<Message>) {
      all.push({ authorId: m.author.id, authorName: m.author.username, authorIsBot: m.author.bot, content: m.content, createdAt: m.createdAt, url: m.url });
    }
    before = page.last()!.id;
    console.log(`Read ${all.length} messages...`);
  }
  return all;
}

client.once('clientReady', async () => {
  const db = TursoDatabase.connect(dbUrl, process.env.TURSO_AUTH_TOKEN);
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error('Channel not found or not a text channel.');
    const messages = await readAll(channel);

    if (apply) await db.migrate();
    console.log(`\n${apply ? 'APPLYING to' : 'DRY RUN against'} ${new URL(dbUrl.replace('libsql://', 'https://')).host}\n`);
    let done = 0;
    const summary = await backfillHistory(messages, db, ignoredIds, {
      apply,
      onPuzzle: () => {
        if (++done % 100 === 0) console.log(`Processed ${done} puzzles...`);
      },
    });
    console.table({
      'messages read': summary.messagesRead,
      'bots skipped': summary.bots,
      'not shares': summary.notShares,
      'impossible shares': summary.invalid,
      'repeat shares (later ones ignored)': summary.duplicates,
      'already in database': summary.alreadyStored,
      [apply ? 'inserted' : 'would insert']: summary.inserted,
      puzzles: summary.puzzles,
      players: summary.players,
    });
    const impossible = formatInvalidShares(summary.invalidShares);
    if (impossible) console.log(`\n${impossible}\n`);
    if (!apply) console.log('Nothing was written. Re-run with --apply to load these results.');
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  } finally {
    db.close();
    await client.destroy();
  }
});

await client.login(token);
