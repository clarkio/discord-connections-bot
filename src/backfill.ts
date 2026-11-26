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
  /** Link to the message, when known, so an odd one can be looked up in Discord. */
  url?: string;
}

/** A message that looks like a share but cannot be a real result, with why. */
export interface InvalidShare {
  reason: string;
  authorName: string;
  postedAt: string;
  url?: string;
  content: string;
}

export interface BackfillSummary {
  /** False for a dry run, where `inserted` means "would insert". */
  applied: boolean;
  messagesRead: number;
  bots: number;
  notShares: number;
  invalid: number;
  /** The same messages the `invalid` count covers, with why each was rejected. */
  invalidShares: InvalidShare[];
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
    invalidShares: [],
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
      summary.invalidShares.push({ reason: parsed.reason, authorName: m.authorName, postedAt: m.createdAt.toISOString(), url: m.url, content: m.content });
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

const SNIPPET_LIMIT = 300;

/** A readable list of the impossible shares: who, when, why, a link, and the message text (trimmed). */
export function formatInvalidShares(shares: InvalidShare[], limit = 20): string {
  if (shares.length === 0) return '';
  const lines = [`Impossible shares (${shares.length}): these look like Connections shares but cannot be a real result, so they were skipped.`];
  shares.slice(0, limit).forEach((s, i) => {
    const when = `${s.postedAt.slice(0, 16).replace('T', ' ')} UTC`;
    const text = s.content.length > SNIPPET_LIMIT ? `${s.content.slice(0, SNIPPET_LIMIT)}…` : s.content;
    lines.push(`${i + 1}. ${when}, ${s.authorName}`, `   Why: ${s.reason}`);
    if (s.url) lines.push(`   ${s.url}`);
    lines.push(...text.split('\n').map((line) => `   | ${line}`));
  });
  if (shares.length > limit) lines.push(`…and ${shares.length - limit} more.`);
  return lines.join('\n');
}
