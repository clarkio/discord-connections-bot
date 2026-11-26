import type { Color, Guess, ParseResult } from './types';

const SQUARES: Record<string, Color> = { '🟨': 'Y', '🟩': 'G', '🟦': 'B', '🟪': 'P' };
const HEADER = /Connections\s*\r?\n\s*Puzzle\s*#\s*([\d,]+)/i;
const MAX_MISTAKES = 4;
const CATEGORY_COUNT = 4;

function toSquares(line: string): string[] | null {
  const chars = Array.from(line.trim());
  if (chars.length === 0) return null;
  return chars.every((c) => c in SQUARES) ? chars : null;
}

/**
 * Parse a Discord message as a Connections share.
 *
 * Returns null when the message does not look like a share at all, so the
 * caller can ignore it. Returns `invalid` when it looks like a share but the
 * result is impossible, so the caller can react with a failure marker.
 * Discord spoiler markers (`||`) around any part of the share are ignored.
 */
export function parseShare(raw: string): ParseResult | null {
  // A share hidden with Discord's spoiler feature arrives wrapped in `||`; the markers are not part of it.
  const text = raw.replace(/\|\|/g, '');
  const header = HEADER.exec(text);
  if (!header) return null;

  const puzzleNumber = parseInt(header[1]!.replace(/,/g, ''), 10);
  const rows = text
    .slice(header.index + header[0].length)
    .split(/\r?\n/)
    .map(toSquares)
    .filter((r): r is string[] => r !== null);

  if (rows.length === 0) return { status: 'invalid', reason: 'no guess rows' };

  const guesses: Guess[] = [];
  for (const row of rows) {
    if (row.length !== 4) return { status: 'invalid', reason: 'a guess row must have four squares' };
    const colors = row.map((c) => SQUARES[c]!);
    const distinct = new Set(colors).size;
    if (distinct === 1) guesses.push({ colors, kind: 'solved', category: colors[0]! });
    else if (distinct === 4) guesses.push({ colors, kind: 'rainbow' });
    else guesses.push({ colors, kind: 'mistake' });
  }

  const solvedOrder: Color[] = [];
  let mistakes = 0;
  let rainbows = 0;
  for (const g of guesses) {
    if (mistakes + rainbows >= MAX_MISTAKES) {
      return { status: 'invalid', reason: 'guess after the fourth mistake' };
    }
    if (g.kind === 'solved') {
      if (solvedOrder.includes(g.category!)) return { status: 'invalid', reason: 'category solved twice' };
      solvedOrder.push(g.category!);
    } else if (g.kind === 'rainbow') rainbows++;
    else mistakes++;
  }

  const failed = mistakes + rainbows === MAX_MISTAKES;
  if (failed && solvedOrder.length === CATEGORY_COUNT) {
    return { status: 'invalid', reason: 'all categories solved despite four mistakes' };
  }
  if (!failed && solvedOrder.length < CATEGORY_COUNT) {
    return { status: 'invalid', reason: 'unfinished puzzle' };
  }

  return { status: 'ok', share: { puzzleNumber, guesses, solvedOrder, mistakes, rainbows, failed } };
}
