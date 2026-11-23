import { COLOR_SQUARE, DIFFICULTY, type Color, type Share } from '../connections/types';
import type { ScoringConfig } from './config';

/** One line of a score explanation. The points of all components add up to the daily score. */
export interface ScoreComponent {
  label: 'categories' | 'mistakes' | 'rainbows' | 'order bonus' | 'position bonus' | 'clean game bonus';
  points: number;
  detail: string;
}

export interface ScoringModel {
  id: 'B' | 'D' | 'P' | 'Q' | 'R';
  /** True when the first key component is a numeric daily score (so margins and totals make sense). */
  scored: boolean;
  /** Higher keys rank better; compare with compareKeys. */
  rankKey(share: Share, cfg: ScoringConfig): number[];
  /** Explains a scored model's daily score; absent for models with no numeric score. */
  breakdown?(share: Share, cfg: ScoringConfig): ScoreComponent[];
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

/**
 * Like positionSteps, but each place a category moved up is worth more units
 * the harder the category is, so solving purple first outweighs solving blue
 * first. This separates solve orders that the plain step count ties.
 */
export function weightedPositionSteps(solvedOrder: Color[], weights: Record<Color, number>): number {
  return solvedOrder.reduce((sum, c, i) => sum + Math.max(0, DIFFICULTY[c] - (i + 1)) * weights[c], 0);
}

/** Model Q: model P with a difficulty-weighted position bonus, in whole units of at least 0.25. */
export const modelQ: ScoringModel = {
  id: 'Q',
  scored: true,
  rankKey(share, cfg) {
    const base = share.solvedOrder.reduce((sum, c) => sum + cfg.categoryWeights[c], 0);
    const penalty = share.mistakes * cfg.mistakePenalty + share.rainbows * cfg.rainbowPenalty;
    const units = weightedPositionSteps(share.solvedOrder, cfg.positionStepWeights);
    return [base - penalty + units * cfg.weightedPositionBonusPerUnit];
  },
};

const ALL_ORDERS: Color[][] = (() => {
  const make = (pool: Color[]): Color[][] =>
    pool.length === 0 ? [[]] : pool.flatMap((c) => make(pool.filter((x) => x !== c)).map((rest) => [c, ...rest]));
  return make(['Y', 'G', 'B', 'P']);
})();

/** The largest model-Q position bonus any solve order can earn under this config. */
export function maxPositionBonus(cfg: ScoringConfig): number {
  return Math.max(...ALL_ORDERS.map((o) => weightedPositionSteps(o, cfg.positionStepWeights))) * cfg.weightedPositionBonusPerUnit;
}

/** The clean-game bonus in effect: the configured number, or the smallest whole number above the largest position bonus. */
export function cleanGameBonusFor(cfg: ScoringConfig): number {
  return cfg.cleanGameBonus === 'auto' ? Math.floor(maxPositionBonus(cfg)) + 1 : cfg.cleanGameBonus;
}

const isClean = (share: Share) => share.mistakes + share.rainbows === 0;

/**
 * Model R: model Q plus a whole-number bonus for a game with no mistakes, sized so
 * a clean game always outscores any game with a mistake, whatever the solve order.
 */
export const modelR: ScoringModel = {
  id: 'R',
  scored: true,
  rankKey(share, cfg) {
    return [modelQ.rankKey(share, cfg)[0]! + (isClean(share) ? cleanGameBonusFor(cfg) : 0)];
  },
  breakdown(share, cfg) {
    const parts = modelQ.breakdown!(share, cfg);
    if (isClean(share)) {
      const bonus = cleanGameBonusFor(cfg);
      parts.push({ label: 'clean game bonus', points: bonus, detail: 'no mistakes' });
    }
    return parts;
  },
};

export const ALL_MODELS: ScoringModel[] = [modelB, modelD, modelP, modelQ, modelR];

/** Pick models by id from a comma-separated list or "all". With no value, the scored models D, P, Q and R. */
export function resolveModels(value?: string): ScoringModel[] {
  if (value === undefined) return [modelD, modelP, modelQ, modelR];
  if (value.trim().toLowerCase() === 'all') return ALL_MODELS;
  return value.split(',').map((raw) => {
    const id = raw.trim().toUpperCase();
    const model = ALL_MODELS.find((m) => m.id === id);
    if (!model) throw new Error(`Unknown model "${raw.trim()}". Use B, D, P, Q, R or all.`);
    return model;
  });
}

const ORDINAL = ['1st', '2nd', '3rd', '4th'];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Pairs of solved categories where the harder was solved first, as "🟪 before 🟨". */
function pairList(solvedOrder: Color[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < solvedOrder.length; i++) {
    for (let j = i + 1; j < solvedOrder.length; j++) {
      if (DIFFICULTY[solvedOrder[i]!] > DIFFICULTY[solvedOrder[j]!]) out.push(`${COLOR_SQUARE[solvedOrder[i]!]} before ${COLOR_SQUARE[solvedOrder[j]!]}`);
    }
  }
  return out;
}

/** The components every scored model shares: category points, mistakes and rainbows. */
function baseComponents(share: Share, cfg: ScoringConfig): ScoreComponent[] {
  const parts: ScoreComponent[] = [
    {
      label: 'categories',
      points: share.solvedOrder.reduce((sum, c) => sum + cfg.categoryWeights[c], 0),
      detail: share.solvedOrder.map((c) => `${COLOR_SQUARE[c]}+${cfg.categoryWeights[c]}`).join(' ') || 'none solved',
    },
  ];
  if (share.mistakes > 0) {
    parts.push({ label: 'mistakes', points: -share.mistakes * cfg.mistakePenalty, detail: `${share.mistakes} × -${cfg.mistakePenalty}` });
  }
  if (share.rainbows > 0) {
    parts.push({ label: 'rainbows', points: -share.rainbows * cfg.rainbowPenalty, detail: `${share.rainbows} × -${cfg.rainbowPenalty}` });
  }
  return parts;
}

/** Places each solved category moved up, with the steps it earned (zero-step categories omitted). */
function stepsByCategory(solvedOrder: Color[]): { color: Color; place: string; steps: number }[] {
  return solvedOrder
    .map((color, i) => ({ color, place: ORDINAL[i]!, steps: Math.max(0, DIFFICULTY[color] - (i + 1)) }))
    .filter((x) => x.steps > 0);
}

modelD.breakdown = (share, cfg) => {
  const parts = baseComponents(share, cfg);
  const pairs = pairList(share.solvedOrder);
  if (pairs.length > 0) {
    parts.push({
      label: 'order bonus',
      points: pairs.length * cfg.orderBonusPerPair,
      detail: `${plural(pairs.length, 'pair')} × ${cfg.orderBonusPerPair} (${pairs.join(', ')})`,
    });
  }
  return parts;
};

modelP.breakdown = (share, cfg) => {
  const parts = baseComponents(share, cfg);
  const moved = stepsByCategory(share.solvedOrder);
  const steps = moved.reduce((t, m) => t + m.steps, 0);
  if (steps > 0) {
    parts.push({
      label: 'position bonus',
      points: steps * cfg.positionBonusPerStep,
      detail: `${moved.map((m) => `${COLOR_SQUARE[m.color]} solved ${m.place}: ${plural(m.steps, 'step')}`).join('; ')}; ${plural(steps, 'step')} × ${cfg.positionBonusPerStep}`,
    });
  }
  return parts;
};

modelQ.breakdown = (share, cfg) => {
  const parts = baseComponents(share, cfg);
  const moved = stepsByCategory(share.solvedOrder);
  const units = moved.reduce((t, m) => t + m.steps * cfg.positionStepWeights[m.color], 0);
  if (units > 0) {
    parts.push({
      label: 'position bonus',
      points: units * cfg.weightedPositionBonusPerUnit,
      detail: `${moved
        .map((m) => `${COLOR_SQUARE[m.color]} solved ${m.place}: ${plural(m.steps, 'step')} × ${cfg.positionStepWeights[m.color]} = ${m.steps * cfg.positionStepWeights[m.color]}`)
        .join('; ')}; ${plural(units, 'unit')} × ${cfg.weightedPositionBonusPerUnit}`,
    });
  }
  return parts;
};
