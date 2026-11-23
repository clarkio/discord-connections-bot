import type { Share } from './connections/types';
import type { ConnectionsDatabase, PuzzleEntry } from './db/types';
import { describeComponent } from './scoring/format';
import { PRODUCTION_CONFIG, PRODUCTION_MODEL } from './scoring/production';
import { determineWinners } from './scoring/winners';

export interface Author {
  id: string;
  username: string;
}

export type ProcessOutcome =
  | { status: 'duplicate' }
  | {
      status: 'saved';
      puzzleNumber: number;
      dailyScore: number;
      /** Current winners of the puzzle, excluding ignored players. Empty if only ignored players have shared. */
      winners: PuzzleEntry[];
      isTie: boolean;
      /** True when this share's author is among the current winners and should be announced. */
      announce: boolean;
      /** The sharer's own stored result and score, whether or not they are winning (or ignored). */
      sharer: PuzzleEntry;
    };

/** Rebuild the parts of a share the scoring needs from what was stored. */
function toShare(entry: PuzzleEntry): Share {
  const { result } = entry;
  return {
    puzzleNumber: result.puzzleNumber,
    guesses: [],
    solvedOrder: result.solvedOrder,
    mistakes: result.mistakes,
    rainbows: result.rainbows,
    failed: result.failed,
  };
}

/**
 * Record a share, score it, and work out who is winning that puzzle now.
 * The first share per player and puzzle counts; later ones are ignored.
 */
export async function processShare(
  share: Share,
  author: Author,
  postedAt: Date,
  db: ConnectionsDatabase,
  ignoredIds: Set<string>,
): Promise<ProcessOutcome> {
  if (await db.hasResult(author.id, share.puzzleNumber)) return { status: 'duplicate' };

  await db.upsertPlayer(author.id, author.username);
  const dailyScore = PRODUCTION_MODEL.rankKey(share, PRODUCTION_CONFIG)[0]!;
  const stored = await db.saveResult(
    {
      discordId: author.id,
      puzzleNumber: share.puzzleNumber,
      guessRows: share.guesses.map((g) => g.colors.join('')),
      solvedOrder: share.solvedOrder,
      mistakes: share.mistakes,
      rainbows: share.rainbows,
      failed: share.failed,
      postedAt: postedAt.toISOString(),
    },
    dailyScore,
  );
  if (!stored) return { status: 'duplicate' };

  const { entries, eligible, won, isTie } = await refreshOutcomes(share.puzzleNumber, db, ignoredIds);

  return {
    status: 'saved',
    puzzleNumber: share.puzzleNumber,
    dailyScore,
    winners: eligible.filter((e) => won.has(e.discordId)),
    isTie,
    announce: won.has(author.id),
    sharer: entries.find((e) => e.discordId === author.id)!,
  };
}

/**
 * Work out who is winning a puzzle from everything stored for it, and record each
 * player's win or tie flag. Ignored players are stored but never count toward winners or ties.
 */
export async function refreshOutcomes(
  puzzleNumber: number,
  db: ConnectionsDatabase,
  ignoredIds: Set<string>,
): Promise<{ entries: PuzzleEntry[]; eligible: PuzzleEntry[]; won: Set<string>; isTie: boolean }> {
  const entries = await db.getPuzzleEntries(puzzleNumber);
  const eligible = entries.filter((e) => !ignoredIds.has(e.discordId));
  const { winners: winnerIds, isTie } = determineWinners(
    eligible.map((e) => ({ playerId: e.discordId, share: toShare(e) })),
    PRODUCTION_MODEL,
    PRODUCTION_CONFIG,
  );

  const won = new Set(winnerIds);
  await db.setOutcomes(
    puzzleNumber,
    entries.map((e) => ({ discordId: e.discordId, isWin: won.has(e.discordId) && !isTie, isTie: won.has(e.discordId) && isTie })),
  );
  return { entries, eligible, won, isTie };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Discord rejects messages over 2000 characters; leave room for a closing note. */
const DISCORD_LIMIT = 2000;
const FOOTER_RESERVE = 100;

type SavedOutcome = Extract<ProcessOutcome, { status: 'saved' }>;

const summary = (e: PuzzleEntry) =>
  `solved ${e.result.solvedOrder.length}/4, ${plural(e.result.mistakes + e.result.rainbows, 'mistake')}`;

/** The score breakdown as bullet lines. */
function breakdownLines(e: PuzzleEntry): string[] {
  return PRODUCTION_MODEL.breakdown!(toShare(e), PRODUCTION_CONFIG).map((c) => `• ${describeComponent(c)}`);
}

const whoIs = (e: PuzzleEntry, tagging: boolean) => (tagging ? `<@${e.discordId}>` : e.discordName);

/**
 * The channel message for a share whose author is among the current winners:
 * the winner line, then how each winner's score breaks down.
 */
export function formatAnnouncement(outcome: SavedOutcome, tagging: boolean): string {
  const [first] = outcome.winners;
  const names = outcome.winners.map((e) => whoIs(e, tagging)).join(', ');

  if (outcome.winners.length === 1) {
    return [
      `Current Winner for Connections #${outcome.puzzleNumber} with ${first!.dailyScore} points (${summary(first!)}): ${names}`,
      ...breakdownLines(first!),
    ].join('\n');
  }

  let text = `Current Winners (tie) for Connections #${outcome.puzzleNumber} with ${first!.dailyScore} points: ${names}`;
  let shown = 0;
  for (const winner of outcome.winners) {
    const block = [`${whoIs(winner, tagging)}: ${summary(winner)}`, ...breakdownLines(winner)].join('\n');
    if ((text + '\n' + block).length > DISCORD_LIMIT - FOOTER_RESERVE) break;
    text += '\n' + block;
    shown++;
  }
  const left = outcome.winners.length - shown;
  if (left > 0) text += `\n…and ${left} more tied winners (details left out to fit Discord's message limit)`;
  return text.slice(0, DISCORD_LIMIT);
}

/** The reply to a share whose author is not currently winning: their result and how it was scored. */
export function formatShareReply(outcome: SavedOutcome, tagging: boolean): string {
  const { sharer } = outcome;
  return [
    `${whoIs(sharer, tagging)} Puzzle #${outcome.puzzleNumber}: ${sharer.dailyScore} points, ${summary(sharer)}`,
    ...breakdownLines(sharer),
  ].join('\n');
}
