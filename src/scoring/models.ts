import { DIFFICULTY, type Color, type Share } from '../connections/types';
import type { ScoringConfig } from './config';

export interface ScoringModel {
  id: 'B' | 'D' | 'P';
  /** True when the first key component is a numeric daily score (so margins and totals make sense). */
  scored: boolean;
  /** Higher keys rank better; compare with compareKeys. */
  rankKey(share: Share, cfg: ScoringConfig): number[];
}

/** Number of pairs of solved categories where the harder one was solved first. */
export function orderPairs(solvedOrder: Color[]): number {
  let pairs = 0;
  for (let i = 0; i < solvedOrder.length; i++) {
    for (let j = i + 1; j < solvedOrder.length; j++) {
      if (DIFFICULTY[solvedOrder[i]!] > DIFFICULTY[solvedOrder[j]!]) pairs++;
    }
  }
  return pairs;
}

/** Lexicographic comparison: positive when a ranks better than b. */
export function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Model D: weighted points per category, minus mistakes, plus the order bonus. */
export const modelD: ScoringModel = {
  id: 'D',
  scored: true,
  rankKey(share, cfg) {
    const base = share.solvedOrder.reduce((sum, c) => sum + cfg.categoryWeights[c], 0);
    const penalty = share.mistakes * cfg.mistakePenalty + share.rainbows * cfg.rainbowPenalty;
    return [base - penalty + orderPairs(share.solvedOrder) * cfg.orderBonusPerPair];
  },
};

/** Model B: categories solved, then fewest mistakes (rainbows count partially), then solve order. */
export const modelB: ScoringModel = {
  id: 'B',
  scored: false,
  rankKey(share, cfg) {
    const effectiveMistakes = share.mistakes + share.rainbows * cfg.rainbowMistakeWeight;
    return [
      share.solvedOrder.length,
      -effectiveMistakes,
      cfg.orderTiebreak ? orderPairs(share.solvedOrder) : 0,
    ];
  },
};

/**
 * Places a category was solved ahead of its natural position (yellow 1st, green
 * 2nd, blue 3rd, purple 4th), summed over the solved categories. Solving at or
 * after the natural position earns nothing, so purple earns 3/2/1/0 for 1st to
 * 4th, blue 2/1/0/0, green 1/0/0/0 and yellow never.
 */
export function positionSteps(solvedOrder: Color[]): number {
  return solvedOrder.reduce((sum, c, i) => sum + Math.max(0, DIFFICULTY[c] - (i + 1)), 0);
}

/** Model P: model D's points, but the bonus rewards solving harder categories earlier. */
export const modelP: ScoringModel = {
  id: 'P',
  scored: true,
  rankKey(share, cfg) {
    const base = share.solvedOrder.reduce((sum, c) => sum + cfg.categoryWeights[c], 0);
    const penalty = share.mistakes * cfg.mistakePenalty + share.rainbows * cfg.rainbowPenalty;
    return [base - penalty + positionSteps(share.solvedOrder) * cfg.positionBonusPerStep];
  },
};
