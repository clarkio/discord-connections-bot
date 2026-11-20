import { parseShare } from './connections/parser';
import type { Share } from './connections/types';
import type { ConnectionsDatabase } from './db/types';
import { PRODUCTION_CONFIG, PRODUCTION_MODEL } from './scoring/production';
import { refreshOutcomes } from './processor';

/** A channel message as the backfill needs it, with the real author. */
export interface BackfillMessage {
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  content: string;
  createdAt: Date;
}

export interface BackfillSummary {
  /** False for a dry run, where `inserted` means "would insert". */
  applied: boolean;
  messagesRead: number;
  bots: number;
  notShares: number;
  invalid: number;
  /** Later shares by a player for a puzzle they had already shared in this history. */
  duplicates: number;
  /** Shares whose player and puzzle were already in the database; these are left untouched. */
  alreadyStored: number;
  inserted: number;
  puzzles: number;
  players: number;
}

interface Candidate {
  share: Share;
  authorId: string;
  authorName: string;
  createdAt: Date;
}

/**
 * Load past channel messages into the database as if the live bot had seen them
 * in order. The first share per player and puzzle counts, results already stored
 * are never overwritten, nobody is announced, and running it again is harmless.
 * With `apply: false` it only reports what it would do.
 */
export async function backfillHistory(
  messages: BackfillMessage[],
  db: ConnectionsDatabase,
  ignoredIds: Set<string>,
  options: { apply: boolean; onPuzzle?: (puzzleNumber: number) => void },
): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    applied: options.apply,
    messagesRead: messages.length,
    bots: 0,
    notShares: 0,
    invalid: 0,
    duplicates: 0,
    alreadyStored: 0,
    inserted: 0,
    puzzles: 0,
    players: 0,
  };

  // The earliest valid share per player and puzzle wins, however the messages are ordered.
  const byPuzzle = new Map<number, Map<string, Candidate>>();
  for (const m of [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (m.authorIsBot) {
      summary.bots++;
      continue;
    }
    const parsed = parseShare(m.content);
    if (!parsed) {
      summary.notShares++;
      continue;
    }
    if (parsed.status === 'invalid') {
      summary.invalid++;
      continue;
    }
    const puzzle = byPuzzle.get(parsed.share.puzzleNumber) ?? new Map<string, Candidate>();
    if (puzzle.has(m.authorId)) {
      summary.duplicates++;
      continue;
    }
    puzzle.set(m.authorId, { share: parsed.share, authorId: m.authorId, authorName: m.authorName, createdAt: m.createdAt });
    byPuzzle.set(parsed.share.puzzleNumber, puzzle);
  }

  const players = new Set<string>();
  summary.puzzles = byPuzzle.size;

  for (const puzzleNumber of [...byPuzzle.keys()].sort((a, b) => a - b)) {
    let insertedHere = 0;
    for (const c of byPuzzle.get(puzzleNumber)!.values()) {
      players.add(c.authorId);
      if (!options.apply) {
        if (await db.hasResult(c.authorId, puzzleNumber)) summary.alreadyStored++;
        else summary.inserted++;
        continue;
      }
      await db.upsertPlayer(c.authorId, c.authorName);
      const stored = await db.saveResult(
        {
          discordId: c.authorId,
          puzzleNumber,
          guessRows: c.share.guesses.map((g) => g.colors.join('')),
          solvedOrder: c.share.solvedOrder,
          mistakes: c.share.mistakes,
          rainbows: c.share.rainbows,
          failed: c.share.failed,
          postedAt: c.createdAt.toISOString(),
        },
        PRODUCTION_MODEL.rankKey(c.share, PRODUCTION_CONFIG)[0]!,
      );
      if (stored) {
        summary.inserted++;
        insertedHere++;
      } else summary.alreadyStored++;
    }
    if (options.apply && insertedHere > 0) await refreshOutcomes(puzzleNumber, db, ignoredIds);
    options.onPuzzle?.(puzzleNumber);
  }

  summary.players = players.size;
  return summary;
}
