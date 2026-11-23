import { describe, expect, test } from 'bun:test';
import type { Color, Share } from '../connections/types';
import { DEFAULT_CONFIG, type ScoringConfig } from '../scoring/config';
import { cleanGameBonusFor, maxPositionBonus, modelQ, modelR, type ScoringModel } from '../scoring/models';

const COLORS: Color[] = ['Y', 'G', 'B', 'P'];

/** Every ordered selection of k distinct categories. */
function orders(k: number, pool: Color[] = COLORS): Color[][] {
  if (k === 0) return [[]];
  return pool.flatMap((c) => orders(k - 1, pool.filter((x) => x !== c)).map((rest) => [c, ...rest]));
}

function share(solvedOrder: Color[], mistakes: number, rainbows: number): Share {
  return { puzzleNumber: 1, guesses: [], solvedOrder, mistakes, rainbows, failed: mistakes + rainbows === 4 };
}

/** Every valid share the game can produce, split into clean (no mistakes at all) and not. */
function allShares() {
  const clean: Share[] = [];
  const mistaken: Share[] = [];
  for (let k = 0; k <= 4; k++) {
    for (const order of orders(k)) {
      for (let m = 0; m <= 4; m++) {
        for (let r = 0; m + r <= 4; r++) {
          const total = m + r;
          const valid = total === 4 ? k <= 3 : k === 4;
          if (!valid) continue;
          (total === 0 ? clean : mistaken).push(share(order, m, r));
        }
      }
    }
  }
  return { clean, mistaken };
}

const GENTLE = { Y: 0, G: 1, B: 2, P: 3 };
const configs: [string, ScoringConfig][] = [];
for (const unit of [0.25, 0.5]) {
  for (const weights of [DEFAULT_CONFIG.positionStepWeights, GENTLE]) {
    for (const rainbowPenalty of [0, 0.5, 1]) {
      configs.push([
        `unit ${unit}, weights ${Object.values(weights).join('-')}, rainbow ${rainbowPenalty}`,
        { ...DEFAULT_CONFIG, weightedPositionBonusPerUnit: unit, positionStepWeights: weights, rainbowPenalty },
      ]);
    }
  }
}

const range = (model: ScoringModel, shares: Share[], cfg: ScoringConfig) => {
  const scores = shares.map((s) => model.rankKey(s, cfg)[0]!);
  return { min: Math.min(...scores), max: Math.max(...scores) };
};

describe('the problem: without a guard, a mistake can beat a clean game', () => {
  test('model Q lets a one-mistake hardest-first game outscore a clean natural-order game', () => {
    const clean = modelQ.rankKey(share(['Y', 'G', 'B', 'P'], 0, 0), DEFAULT_CONFIG)[0]!;
    const mistaken = modelQ.rankKey(share(['P', 'B', 'G', 'Y'], 1, 0), DEFAULT_CONFIG)[0]!;
    expect(mistaken).toBeGreaterThan(clean);
  });
});

describe('model R: a clean game always beats any game with a mistake', () => {
  const { clean, mistaken } = allShares();

  test('the enumeration covers every clean solve order and every mistaken game', () => {
    expect(clean).toHaveLength(24);
    expect(mistaken).toHaveLength(421); // 216 solved-with-mistakes + 205 failed
  });

  test.each(configs)('worst clean game beats best mistaken game: %s', (_label, cfg) => {
    expect(range(modelR, clean, cfg).min).toBeGreaterThan(range(modelR, mistaken, cfg).max);
  });

  test('that includes rainbow guesses, which still count as a mistake', () => {
    const rainbowOnly = share(['P', 'B', 'G', 'Y'], 0, 1);
    const naturalClean = share(['Y', 'G', 'B', 'P'], 0, 0);
    expect(modelR.rankKey(naturalClean, DEFAULT_CONFIG)[0]!).toBeGreaterThan(modelR.rankKey(rainbowOnly, DEFAULT_CONFIG)[0]!);
  });

  test('the clean-game bonus is a whole number at least as large as the biggest position bonus', () => {
    for (const [, cfg] of configs) {
      const bonus = cleanGameBonusFor(cfg);
      expect(Number.isInteger(bonus)).toBe(true);
      expect(bonus).toBeGreaterThan(maxPositionBonus(cfg));
    }
  });

  test('at the default settings the largest position bonus is 3.75 and the clean bonus is 4', () => {
    expect(maxPositionBonus(DEFAULT_CONFIG)).toBe(3.75);
    expect(cleanGameBonusFor(DEFAULT_CONFIG)).toBe(4);
  });

  test('the clean-game bonus can be set by hand', () => {
    expect(cleanGameBonusFor({ ...DEFAULT_CONFIG, cleanGameBonus: 6 })).toBe(6);
  });

  test('scores for clean games are model Q plus the bonus; games with mistakes are unchanged from Q', () => {
    const cleanShare = share(['P', 'B', 'G', 'Y'], 0, 0);
    expect(modelR.rankKey(cleanShare, DEFAULT_CONFIG)[0]).toBe(modelQ.rankKey(cleanShare, DEFAULT_CONFIG)[0]! + 4);
    const mistakenShare = share(['P', 'B', 'G', 'Y'], 1, 0);
    expect(modelR.rankKey(mistakenShare, DEFAULT_CONFIG)[0]).toBe(modelQ.rankKey(mistakenShare, DEFAULT_CONFIG)[0]);
  });

  test('ordering among clean games, and among mistaken games, is exactly as in model Q', () => {
    const a = share(['P', 'B', 'G', 'Y'], 0, 0);
    const b = share(['B', 'P', 'G', 'Y'], 0, 0);
    const diffQ = modelQ.rankKey(a, DEFAULT_CONFIG)[0]! - modelQ.rankKey(b, DEFAULT_CONFIG)[0]!;
    const diffR = modelR.rankKey(a, DEFAULT_CONFIG)[0]! - modelR.rankKey(b, DEFAULT_CONFIG)[0]!;
    expect(diffR).toBe(diffQ);
  });

  test('a clean-game bonus component explains the extra points', () => {
    const parts = modelR.breakdown!(share(['Y', 'G', 'B', 'P'], 0, 0), DEFAULT_CONFIG);
    expect(parts.find((c) => c.label === 'clean game bonus')).toMatchObject({ points: 4, detail: 'no mistakes' });
    expect(parts.reduce((t, c) => t + c.points, 0)).toBe(14);
  });

  test('no clean-game component for a game with a mistake', () => {
    const parts = modelR.breakdown!(share(['Y', 'G', 'B', 'P'], 1, 0), DEFAULT_CONFIG);
    expect(parts.find((c) => c.label === 'clean game bonus')).toBeUndefined();
  });
});
