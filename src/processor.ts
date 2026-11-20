import type { Share } from './connections/types';
import type { ConnectionsDatabase, PuzzleEntry } from './db/types';
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

  // Ignored players are recorded but never counted toward winners or ties.
  const entries = await db.getPuzzleEntries(share.puzzleNumber);
  const eligible = entries.filter((e) => !ignoredIds.has(e.discordId));
  const { winners: winnerIds, isTie } = determineWinners(
    eligible.map((e) => ({ playerId: e.discordId, share: toShare(e) })),
    PRODUCTION_MODEL,
    PRODUCTION_CONFIG,
  );

  const won = new Set(winnerIds);
  await db.setOutcomes(
    share.puzzleNumber,
    entries.map((e) => ({ discordId: e.discordId, isWin: won.has(e.discordId) && !isTie, isTie: won.has(e.discordId) && isTie })),
  );

  return {
    status: 'saved',
    puzzleNumber: share.puzzleNumber,
    dailyScore,
    winners: eligible.filter((e) => won.has(e.discordId)),
    isTie,
    announce: won.has(author.id),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The channel message for a saved outcome that should be announced. */
export function formatAnnouncement(outcome: Extract<ProcessOutcome, { status: 'saved' }>, tagging: boolean): string {
  const who = (e: PuzzleEntry) => (tagging ? `<@${e.discordId}>` : e.discordName);
  const [first] = outcome.winners;
  const names = outcome.winners.map(who).join(', ');

  if (outcome.winners.length > 1) {
    return `Current Winners (tie) for Connections #${outcome.puzzleNumber} with ${first!.dailyScore} points: ${names}`;
  }
  const { solvedOrder, mistakes, rainbows } = first!.result;
  return `Current Winner for Connections #${outcome.puzzleNumber} with ${first!.dailyScore} points (solved ${solvedOrder.length}/4, ${plural(mistakes + rainbows, 'mistake')}): ${names}`;
}
