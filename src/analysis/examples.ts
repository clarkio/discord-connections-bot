import type { Color } from '../connections/types';
import type { ScoringConfig } from '../scoring/config';
import type { ScoringModel } from '../scoring/models';
import { determineWinners, type Entry } from '../scoring/winners';

const SQUARE: Record<Color, string> = { Y: '🟨', G: '🟩', B: '🟦', P: '🟪' };

export interface ExamplePlayer {
  playerId: string;
  rows: string;
  key: number[];
  winner: boolean;
}

export interface Example {
  puzzleNumber: number;
  players: ExamplePlayer[];
}

export interface Examples {
  /** Exactly one winner. */
  clearWinner: Example[];
  /** Two or more winners, but not everyone. */
  tie: Example[];
  /** Every player tied for first, so nobody stood out. */
  allTied: Example[];
}

/**
 * Pick example puzzles of each outcome kind. Puzzles with more players come
 * first (they are more informative), then the most recent. One-player puzzles
 * are never examples.
 */
export function pickExamples(
  groups: Map<number, Entry[]>,
  model: ScoringModel,
  cfg: ScoringConfig,
  perKind: number,
): Examples {
  const out: Examples = { clearWinner: [], tie: [], allTied: [] };
  const candidates = [...groups.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .sort(([na, a], [nb, b]) => b.length - a.length || nb - na);

  for (const [puzzleNumber, entries] of candidates) {
    const { winners, ranking } = determineWinners(entries, model, cfg);
    const kind: keyof Examples =
      winners.length === 1 ? 'clearWinner' : winners.length === entries.length ? 'allTied' : 'tie';
    if (out[kind].length >= perKind) continue;
    out[kind].push({
      puzzleNumber,
      players: ranking!.map((r) => ({
        playerId: r.playerId,
        rows: r.share.guesses.map((g) => g.colors.map((c) => SQUARE[c]).join('')).join(' '),
        key: r.key,
        winner: winners.includes(r.playerId),
      })),
    });
  }
  return out;
}

export function formatExample(ex: Example, model: ScoringModel): string {
  const lines = ex.players.map((p) => {
    const result =
      model.id === 'D'
        ? `score ${p.key[0]}`
        : `solved ${p.key[0]}, mistakes ${-p.key[1]!}, order ${p.key[2]}`;
    return `  ${p.winner ? '🏆' : '  '} ${p.playerId.slice(0, 8)}  ${result.padEnd(32)} ${p.rows}`;
  });
  return [`Puzzle #${ex.puzzleNumber}`, ...lines].join('\n');
}
