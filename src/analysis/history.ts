import { createHash } from 'node:crypto';
import { parseShare } from '../connections/parser';
import type { Share } from '../connections/types';
import type { Entry } from '../scoring/winners';

/**
 * One exported share. Deliberately minimal: a salted player hash, the puzzle
 * number, and only the guess rows. No Discord ids, names or free text.
 */
export interface HistoryRecord {
  playerHash: string;
  puzzleNumber: number;
  rows: string[];
  postedAt: string;
}

export interface RawMessage {
  authorId: string;
  authorIsBot: boolean;
  content: string;
  createdAt: string;
}

export interface SkipCounts {
  notShares: number;
  bots: number;
  invalid: number;
}

export function hashPlayer(authorId: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${authorId}`).digest('hex').slice(0, 16);
}

export function buildRecords(
  messages: RawMessage[],
  salt: string,
): { records: HistoryRecord[]; skipped: SkipCounts } {
  const records: HistoryRecord[] = [];
  const skipped: SkipCounts = { notShares: 0, bots: 0, invalid: 0 };

  for (const m of messages) {
    if (m.authorIsBot) {
      skipped.bots++;
      continue;
    }
    const parsed = parseShare(m.content);
    if (!parsed) {
      skipped.notShares++;
    } else if (parsed.status === 'invalid') {
      skipped.invalid++;
    } else {
      records.push({
        playerHash: hashPlayer(m.authorId, salt),
        puzzleNumber: parsed.share.puzzleNumber,
        rows: parsed.share.guesses.map((g) => g.colors.join('')),
        postedAt: m.createdAt,
      });
    }
  }
  return { records, skipped };
}

const SQUARE: Record<string, string> = { Y: '🟨', G: '🟩', B: '🟦', P: '🟪' };

function recordToShare(r: HistoryRecord): Share | null {
  const text = `Connections\nPuzzle #${r.puzzleNumber}\n${r.rows.map((row) => Array.from(row).map((c) => SQUARE[c]).join('')).join('\n')}`;
  const parsed = parseShare(text);
  return parsed?.status === 'ok' ? parsed.share : null;
}

/** Group by puzzle; the first share per player and puzzle (by posted time) counts. */
export function groupByPuzzle(records: HistoryRecord[]): Map<number, Entry[]> {
  const sorted = [...records].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const seen = new Set<string>();
  const groups = new Map<number, Entry[]>();

  for (const r of sorted) {
    const key = `${r.playerHash}:${r.puzzleNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const share = recordToShare(r);
    if (!share) continue;
    const list = groups.get(r.puzzleNumber) ?? [];
    list.push({ playerId: r.playerHash, share });
    groups.set(r.puzzleNumber, list);
  }
  return groups;
}
