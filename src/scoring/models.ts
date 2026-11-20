import { DIFFICULTY, type Color, type Share } from '../connections/types';
import type { ScoringConfig } from './config';

export interface ScoringModel {
  id: 'B' | 'D';
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
  rankKey(share, cfg) {
    const base = share.solvedOrder.reduce((sum, c) => sum + cfg.categoryWeights[c], 0);
    const penalty = share.mistakes * cfg.mistakePenalty + share.rainbows * cfg.rainbowPenalty;
    return [base - penalty + orderPairs(share.solvedOrder) * cfg.orderBonusPerPair];
  },
};

/** Model B: categories solved, then fewest mistakes (rainbows count partially), then solve order. */
export const modelB: ScoringModel = {
  id: 'B',
  rankKey(share, cfg) {
    const effectiveMistakes = share.mistakes + share.rainbows * cfg.rainbowMistakeWeight;
    return [
      share.solvedOrder.length,
      -effectiveMistakes,
      cfg.orderTiebreak ? orderPairs(share.solvedOrder) : 0,
    ];
  },
};
