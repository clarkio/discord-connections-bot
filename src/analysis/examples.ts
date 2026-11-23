import { COLOR_SQUARE, type Color } from '../connections/types';
import type { ScoringConfig } from '../scoring/config';
import { describeComponent } from '../scoring/format';
import type { ScoreComponent, ScoringModel } from '../scoring/models';
import { determineWinners, type Entry } from '../scoring/winners';

export interface ExamplePlayer {
  playerId: string;
  rows: string;
  key: number[];
  winner: boolean;
  /** How a scored model reached the score; absent for models with no numeric score. */
  breakdown?: ScoreComponent[];
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
 * are never examples. With `solvedFirst`, only puzzles where at least one
 * player solved that category first are used, and every player in them is shown.
 */
export function pickExamples(
  groups: Map<number, Entry[]>,
  model: ScoringModel,
  cfg: ScoringConfig,
  perKind: number,
  options: { solvedFirst?: Color } = {},
): Examples {
  const out: Examples = { clearWinner: [], tie: [], allTied: [] };
  const candidates = [...groups.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .filter(([, entries]) => !options.solvedFirst || entries.some((e) => e.share.solvedOrder[0] === options.solvedFirst))
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
        rows: r.share.guesses.map((g) => g.colors.map((c) => COLOR_SQUARE[c]).join('')).join(' '),
        key: r.key,
        winner: winners.includes(r.playerId),
        breakdown: model.breakdown?.(r.share, cfg),
      })),
    });
  }
  return out;
}

export function formatExample(ex: Example, model: ScoringModel): string {
  const lines = ex.players.map((p) => {
    const result =
      model.scored
        ? `score ${p.key[0]}`
        : `solved ${p.key[0]}, mistakes ${-p.key[1]!}, order ${p.key[2]}`;
    const head = `  ${p.winner ? '🏆' : '  '} ${p.playerId.slice(0, 8)}  ${result.padEnd(32)} ${p.rows}`;
    const parts = (p.breakdown ?? []).map((c) => `       ${describeComponent(c)}`);
    return [head, ...parts].join('\n');
  });
  return [`Puzzle #${ex.puzzleNumber}`, ...lines].join('\n');
}
