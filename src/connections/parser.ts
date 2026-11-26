import type { Color, Guess, ParseResult } from './types';

const SQUARES: Record<string, Color> = { '🟨': 'Y', '🟩': 'G', '🟦': 'B', '🟪': 'P' };
// "Connections" on one line, "Puzzle #N" on the next; anything else on those two lines is ignored.
const HEADER = /Connections[^\n]*\n\s*Puzzle\s*#\s*([\d,]+)[^\n]*/i;
const MAX_MISTAKES = 4;
const CATEGORY_COUNT = 4;

/** The colour squares a line starts with. Anything after them on the line is ignored. */
function leadingSquares(line: string): string[] {
  const squares: string[] = [];
  for (const char of line.trimStart()) {
    if (!(char in SQUARES)) break;
    squares.push(char);
  }
  return squares;
}

/**
 * Parse a Discord message as a Connections share.
 *
 * Returns null when the message does not look like a share at all, so the
 * caller can ignore it. Returns `invalid` when it looks like a share but the
 * result is impossible, so the caller can react with a failure marker.
 * Discord spoiler markers (`||`) around any part of the share are ignored, and so is any text before the
 * share, after the results, or after the four squares of a row.
 */
export function parseShare(raw: string): ParseResult | null {
  // A share hidden with Discord's spoiler feature arrives wrapped in `||`; the markers are not part of it.
  const text = raw.replace(/\|\|/g, '');
  const header = HEADER.exec(text);
  if (!header) return null;

  const puzzleNumber = parseInt(header[1]!.replace(/,/g, ''), 10);

  // The results are the lines that start with colour squares, straight after the Puzzle line (blank lines
  // before the first row are fine). They end at the first line that does not start with a square; whatever
  // follows is ignored. Anything wrong inside them is reported, never silently skipped.
  const lines = text.slice(header.index + header[0].length).split(/\r?\n/).slice(1);
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  const rows: string[][] = [];
  for (; i < lines.length; i++) {
    const squares = leadingSquares(lines[i]!);
    if (squares.length === 0) break;
    rows.push(squares);
  }
  if (lines.slice(i).some((line) => leadingSquares(line).length > 0)) {
    return { status: 'invalid', reason: 'the rows of squares are interrupted by other text' };
  }
  if (rows.length === 0) return { status: 'invalid', reason: 'the header is there but no rows of coloured squares follow it' };

  const guesses: Guess[] = [];
  for (const row of rows) {
    if (row.length !== 4) return { status: 'invalid', reason: 'a row does not have exactly four squares' };
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
      return { status: 'invalid', reason: 'there are guesses after the fourth mistake, but the game ends at four' };
    }
    if (g.kind === 'solved') {
      if (solvedOrder.includes(g.category!)) return { status: 'invalid', reason: 'the same colour group was solved twice' };
      solvedOrder.push(g.category!);
    } else if (g.kind === 'rainbow') rainbows++;
    else mistakes++;
  }

  const failed = mistakes + rainbows === MAX_MISTAKES;
  if (failed && solvedOrder.length === CATEGORY_COUNT) {
    return { status: 'invalid', reason: 'all four groups are solved but four mistakes were also made, which the game does not allow' };
  }
  if (!failed && solvedOrder.length < CATEGORY_COUNT) {
    return { status: 'invalid', reason: 'the puzzle looks unfinished: fewer than four groups solved and fewer than four mistakes made' };
  }

  return { status: 'ok', share: { puzzleNumber, guesses, solvedOrder, mistakes, rainbows, failed } };
}
