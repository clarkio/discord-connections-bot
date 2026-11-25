import { COMMANDS } from './commands';
import { parseShare } from './connections/parser';
import type { ConnectionsDatabase } from './db/types';
import { formatAnnouncement, formatShareReply, processShare } from './processor';

export const PREFIX = '!';
export const RAINBOW_EMOJI = '🌈';

export interface HandlerContext {
  db: ConnectionsDatabase;
  ignoredIds: Set<string>;
  taggingEnabled: boolean;
  targetChannelId: string;
}

/** The slice of a Discord message the bot uses, so it can be tested without Discord. */
export interface ChatMessage {
  author: { id: string; username: string; bot: boolean };
  content: string;
  channelId: string;
  createdAt: Date;
  react(emoji: string): Promise<void>;
  channel: { send(text: string): Promise<void> };
}

/** USER_TAGGING_ENABLED is on for `true` in any letter case, ignoring surrounding whitespace; anything else is off. */
export function isTaggingEnabled(envValue: string | undefined): boolean {
  return (envValue ?? '').trim().toLowerCase() === 'true';
}

export function parseIgnoredUserIds(envValue: string | undefined): Set<string> {
  return new Set((envValue ?? '').split(',').map((id) => id.trim()).filter(Boolean));
}

/** A rainbow reaction is a flourish: if it fails (say, a missing permission) nothing else should be lost. */
async function reactToRainbow(message: ChatMessage): Promise<void> {
  try {
    await message.react(RAINBOW_EMOJI);
  } catch (error) {
    console.error('Could not add the rainbow reaction:', error);
  }
}

async function handleShare(message: ChatMessage, ctx: HandlerContext): Promise<void> {
  const parsed = parseShare(message.content)!;
  if (parsed.status === 'invalid') {
    await message.react('❌');
    return;
  }
  try {
    const outcome = await processShare(parsed.share, message.author, message.createdAt, ctx.db, ctx.ignoredIds);
    if (outcome.status === 'duplicate') {
      console.log(`Share already recorded: puzzle ${parsed.share.puzzleNumber} - ${message.author.username}`);
      return;
    }
    await message.react('✅');
    if (parsed.share.rainbows > 0) await reactToRainbow(message);
    // One message per counted share: the announcement when they are winning, otherwise their own result.
    await message.channel.send(
      outcome.announce ? formatAnnouncement(outcome, ctx.taggingEnabled) : formatShareReply(outcome, ctx.taggingEnabled),
    );
  } catch (error) {
    console.error('Error processing Connections share:', error);
  }
}

async function handleCommand(message: ChatMessage, ctx: HandlerContext): Promise<void> {
  try {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const name = (args.shift() ?? '').toLowerCase();
    if (!/^[a-z0-9]+$/.test(name)) {
      await message.channel.send('Invalid command.');
      return;
    }
    const command = COMMANDS.get(name);
    if (!command) {
      await message.channel.send(`Unknown command: ${name}`);
      return;
    }
    await command.execute(message, args, { db: ctx.db, ignoredIds: ctx.ignoredIds });
  } catch (error) {
    console.error(error);
    await message.channel.send('There was an error executing that command.');
  }
}

export async function handleMessage(message: ChatMessage, ctx: HandlerContext): Promise<void> {
  if (message.author.bot || message.channelId !== ctx.targetChannelId) return;

  if (parseShare(message.content) !== null) await handleShare(message, ctx);
  else if (message.content.startsWith(PREFIX)) await handleCommand(message, ctx);
}
