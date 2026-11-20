import { describe, expect, test } from 'bun:test';
import { parseShare } from '../connections/parser';
import type { Color, Share } from '../connections/types';
import { DEFAULT_CONFIG } from '../scoring/config';
import { compareKeys, modelB, modelD, modelP, modelQ, orderPairs, positionSteps, resolveModels, weightedPositionSteps } from '../scoring/models';
import { determineWinners } from '../scoring/winners';

function make(rows: string[]): Share {
  const r = parseShare(`Connections\nPuzzle #1\n${rows.join('\n')}`);
  if (r?.status !== 'ok') throw new Error(`bad fixture: ${JSON.stringify(r)}`);
  return r.share;
}

const Y = '🟨🟨🟨🟨', G = '🟩🟩🟩🟩', B = '🟦🟦🟦🟦', P = '🟪🟪🟪🟪';
const MISTAKE = '🟨🟨🟨🟩';
const RAINBOW = '🟨🟩🟦🟪';
const scoreD = (s: Share, cfg = DEFAULT_CONFIG) => modelD.rankKey(s, cfg)[0]!;

describe('orderPairs', () => {
  test('easiest-first has no pairs, hardest-first has six', () => {
    expect(orderPairs(['Y', 'G', 'B', 'P'])).toBe(0);
    expect(orderPairs(['P', 'B', 'G', 'Y'])).toBe(6);
  });
  test('counts each harder-before-easier pair once', () => {
    expect(orderPairs(['P', 'Y', 'G', 'B'])).toBe(3);
    expect(orderPairs(['G', 'Y', 'B', 'P'])).toBe(1);
  });
  test('works on partial solves', () => {
    expect(orderPairs([])).toBe(0);
    expect(orderPairs(['B', 'Y'])).toBe(1);
  });
});

describe('model D: weighted points', () => {
  test('perfect, easiest first, is the 10-point base', () => {
    expect(scoreD(make([Y, G, B, P]))).toBe(10);
  });
  test('hardest first earns 0.5 per pair', () => {
    expect(scoreD(make([P, B, G, Y]))).toBe(13);
  });
  test('an ordinary mistake costs 1', () => {
    expect(scoreD(make([MISTAKE, Y, G, B, P]))).toBe(9);
  });
  test('a rainbow guess costs 0.5, and rainbows stack', () => {
    expect(scoreD(make([RAINBOW, Y, G, B, P]))).toBe(9.5);
    expect(scoreD(make([RAINBOW, RAINBOW, Y, G, B, P]))).toBe(9);
  });
  test('failed with nothing solved and four mistakes is -4, so scores can go negative', () => {
    expect(scoreD(make([MISTAKE, MISTAKE, MISTAKE, MISTAKE]))).toBe(-4);
  });
  test('a failed game keeps partial credit', () => {
    expect(scoreD(make([Y, MISTAKE, MISTAKE, MISTAKE, MISTAKE]))).toBe(-3);
    expect(scoreD(make([Y, RAINBOW, MISTAKE, MISTAKE, MISTAKE]))).toBe(-2.5);
  });
  test('every weight is configurable', () => {
    const cfg = { ...DEFAULT_CONFIG, orderBonusPerPair: 0, rainbowPenalty: 1 };
    expect(scoreD(make([RAINBOW, P, B, G, Y]), cfg)).toBe(9);
  });
});

describe('model B: ranked tuple', () => {
  const key = (s: Share, cfg = DEFAULT_CONFIG) => modelB.rankKey(s, cfg);

  test('more categories solved always outranks fewer mistakes', () => {
    const solvedMoreWithMistakes = make([MISTAKE, MISTAKE, MISTAKE, Y, G, B, P]);
    const failedClean = make([Y, G, MISTAKE, MISTAKE, MISTAKE, MISTAKE]);
    expect(compareKeys(key(solvedMoreWithMistakes), key(failedClean))).toBeGreaterThan(0);
  });
  test('then fewer mistakes, counting a rainbow as half a mistake', () => {
    const one = make([MISTAKE, Y, G, B, P]);
    const half = make([RAINBOW, Y, G, B, P]);
    const zero = make([Y, G, B, P]);
    expect(compareKeys(key(half), key(one))).toBeGreaterThan(0);
    expect(compareKeys(key(zero), key(half))).toBeGreaterThan(0);
  });
  test('then hardest-first solve order breaks the remaining tie', () => {
    expect(compareKeys(key(make([P, B, G, Y])), key(make([Y, G, B, P])))).toBeGreaterThan(0);
  });
  test('the order tiebreak can be switched off', () => {
    const cfg = { ...DEFAULT_CONFIG, orderTiebreak: false };
    expect(compareKeys(key(make([P, B, G, Y]), cfg), key(make([Y, G, B, P]), cfg))).toBe(0);
  });
  test('rainbow weight is configurable', () => {
    const cfg = { ...DEFAULT_CONFIG, rainbowMistakeWeight: 1 };
    expect(compareKeys(key(make([RAINBOW, Y, G, B, P]), cfg), key(make([MISTAKE, Y, G, B, P]), cfg))).toBe(0);
  });
});

describe('determineWinners', () => {
  const entries = (...shares: Share[]) => shares.map((share, i) => ({ playerId: `p${i + 1}`, share }));

  test('a single best result wins outright', () => {
    const r = determineWinners(entries(make([MISTAKE, Y, G, B, P]), make([Y, G, B, P])), modelD, DEFAULT_CONFIG);
    expect(r.winners).toEqual(['p2']);
    expect(r.isTie).toBe(false);
  });
  test('identical scores tie', () => {
    const r = determineWinners(entries(make([Y, G, B, P]), make([Y, G, B, P]), make([MISTAKE, Y, G, B, P])), modelD, DEFAULT_CONFIG);
    expect(r.winners).toEqual(['p1', 'p2']);
    expect(r.isTie).toBe(true);
  });
  test('when everyone fails with the same score, that is a tie', () => {
    const fail = make([MISTAKE, MISTAKE, MISTAKE, MISTAKE]);
    const r = determineWinners(entries(fail, fail), modelD, DEFAULT_CONFIG);
    expect(r.isTie).toBe(true);
    expect(r.winners).toEqual(['p1', 'p2']);
  });
  test('failures are still ranked: a rainbow edge breaks a failed tie', () => {
    const plain = make([MISTAKE, MISTAKE, MISTAKE, MISTAKE]);
    const withRainbow = make([RAINBOW, MISTAKE, MISTAKE, MISTAKE]);
    const r = determineWinners(entries(plain, withRainbow), modelD, DEFAULT_CONFIG);
    expect(r.winners).toEqual(['p2']);
  });
  test('a lone failed player is still the winner', () => {
    const r = determineWinners(entries(make([MISTAKE, MISTAKE, MISTAKE, MISTAKE])), modelD, DEFAULT_CONFIG);
    expect(r.winners).toEqual(['p1']);
    expect(r.isTie).toBe(false);
  });
  test('no entries means no winners', () => {
    expect(determineWinners([], modelD, DEFAULT_CONFIG)).toEqual({ winners: [], isTie: false });
  });
  test('returns the full ranking, best first', () => {
    const r = determineWinners(entries(make([MISTAKE, Y, G, B, P]), make([Y, G, B, P])), modelD, DEFAULT_CONFIG);
    expect(r.ranking?.map((e) => e.playerId)).toEqual(['p2', 'p1']);
  });
});

describe('positionSteps: reward for solving a category ahead of its natural place', () => {
  test('natural order earns nothing', () => {
    expect(positionSteps(['Y', 'G', 'B', 'P'])).toBe(0);
  });
  test('purple earns 3, 2, 1, 0 steps for being solved 1st, 2nd, 3rd, 4th', () => {
    expect(positionSteps(['P'])).toBe(3);
    expect(positionSteps(['Y', 'P'])).toBe(2);
    expect(positionSteps(['Y', 'G', 'P'])).toBe(1);
    expect(positionSteps(['Y', 'G', 'B', 'P'])).toBe(0);
  });
  test('blue earns 2 and 1 steps for 1st and 2nd, and nothing for 3rd or 4th', () => {
    expect(positionSteps(['B'])).toBe(2);
    expect(positionSteps(['Y', 'B'])).toBe(1);
    expect(positionSteps(['Y', 'G', 'B'])).toBe(0);
    expect(positionSteps(['Y', 'G', 'P', 'B'])).toBe(1); // purple 3rd = 1, blue 4th = 0
  });
  test('green earns 1 step only for being solved first; yellow never earns any', () => {
    expect(positionSteps(['G'])).toBe(1);
    expect(positionSteps(['Y', 'G'])).toBe(0);
    expect(positionSteps(['Y'])).toBe(0);
    expect(positionSteps(['G', 'Y'])).toBe(1);
  });
  test('combines categories', () => {
    expect(positionSteps(['P', 'B', 'G', 'Y'])).toBe(4); // 3 + 1
    expect(positionSteps(['B', 'P', 'G', 'Y'])).toBe(4); // 2 + 2
    expect(positionSteps(['P', 'Y', 'G', 'B'])).toBe(3);
  });
  test('partial solves count the positions that were actually reached', () => {
    expect(positionSteps([])).toBe(0);
  });
});

describe('model P: weighted points with a position bonus', () => {
  const scoreP = (s: Share, cfg = DEFAULT_CONFIG) => modelP.rankKey(s, cfg)[0]!;
  const cfg25 = { ...DEFAULT_CONFIG, positionBonusPerStep: 0.25 };

  test('natural order is the plain 10-point base', () => {
    expect(scoreP(make([Y, G, B, P]), cfg25)).toBe(10);
  });
  test('purple first is worth more than purple second, third or fourth', () => {
    const first = scoreP(make([P, Y, G, B]), cfg25);
    const second = scoreP(make([Y, P, G, B]), cfg25);
    const third = scoreP(make([Y, G, P, B]), cfg25);
    const fourth = scoreP(make([Y, G, B, P]), cfg25);
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(third);
    expect(third).toBeGreaterThan(fourth);
  });
  test('blue first or second beats blue third or fourth, which score the same', () => {
    const b1 = scoreP(make([B, Y, G, P]), cfg25);
    const b2 = scoreP(make([Y, B, G, P]), cfg25);
    const b3 = scoreP(make([Y, G, B, P]), cfg25);
    expect(b1).toBeGreaterThan(b2);
    expect(b2).toBeGreaterThan(b3);
    expect(scoreP(make([Y, G, P, B]), cfg25) - scoreP(make([Y, G, B, P]), cfg25)).toBe(0.25); // purple moved up; blue 4th = blue 3rd
  });
  test('adds steps × per-step weight to the base, minus mistakes and rainbows as in model D', () => {
    expect(scoreP(make([P, B, G, Y]), cfg25)).toBe(11); // 10 + 4 steps × 0.25
    expect(scoreP(make([MISTAKE, RAINBOW, P, B, G, Y]), cfg25)).toBe(9.5); // 10 − 1 − 0.5 + 1
  });
  test('a failed game still earns the bonus for what it solved', () => {
    expect(scoreP(make([P, MISTAKE, MISTAKE, MISTAKE, MISTAKE]), cfg25)).toBe(4 - 4 + 0.75);
  });
  test('the per-step weight is configurable', () => {
    expect(scoreP(make([P, B, G, Y]), { ...DEFAULT_CONFIG, positionBonusPerStep: 0 })).toBe(10);
    expect(scoreP(make([P, B, G, Y]), { ...DEFAULT_CONFIG, positionBonusPerStep: 1 })).toBe(14);
  });
});

describe('weightedPositionSteps: position steps scaled by how hard the category is', () => {
  const W = DEFAULT_CONFIG.positionStepWeights;

  test('a step is worth 1, 2, 3 or 4 units depending on the category moved up', () => {
    expect(weightedPositionSteps(['P'], W)).toBe(12); // 3 steps × 4
    expect(weightedPositionSteps(['B'], W)).toBe(6); // 2 steps × 3
    expect(weightedPositionSteps(['G'], W)).toBe(2); // 1 step × 2
    expect(weightedPositionSteps(['Y'], W)).toBe(0);
  });

  test('natural order earns nothing', () => {
    expect(weightedPositionSteps(['Y', 'G', 'B', 'P'], W)).toBe(0);
  });

  test('separates solve orders that the unweighted steps tied', () => {
    // P,B,G,Y and B,P,G,Y were both 4 unweighted steps; going purple first now wins.
    expect(weightedPositionSteps(['P', 'B', 'G', 'Y'], W)).toBe(15);
    expect(weightedPositionSteps(['B', 'P', 'G', 'Y'], W)).toBe(14);
    // P,Y,G,B and G,B,P,Y were both 3 unweighted steps.
    expect(weightedPositionSteps(['P', 'Y', 'G', 'B'], W)).toBe(12);
    expect(weightedPositionSteps(['G', 'B', 'P', 'Y'], W)).toBe(9);
  });

  test('across all 24 solve orders it produces 13 distinct values', () => {
    const perms = (a: Color[]): Color[][] =>
      a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
    const values = new Set(perms(['Y', 'G', 'B', 'P']).map((o) => weightedPositionSteps(o, W)));
    expect(values.size).toBe(13);
  });
});

describe('model Q: weighted points with a difficulty-weighted position bonus', () => {
  const scoreQ = (s: Share, cfg = DEFAULT_CONFIG) => modelQ.rankKey(s, cfg)[0]!;

  test('natural order is the plain 10-point base', () => {
    expect(scoreQ(make([Y, G, B, P]))).toBe(10);
  });
  test('purple first, blue second adds 15 units × 0.25 = 3.75', () => {
    expect(scoreQ(make([P, B, G, Y]))).toBe(13.75);
  });
  test('players who tied under model P are now separated', () => {
    expect(scoreQ(make([P, B, G, Y]))).toBeGreaterThan(scoreQ(make([B, P, G, Y])));
    expect(scoreQ(make([P, Y, G, B]))).toBeGreaterThan(scoreQ(make([G, B, P, Y])));
  });
  test('every distinct solve-order bonus differs by at least one unit (0.25)', () => {
    const orders: Color[][] = [['Y','G','B','P'], ['G','Y','B','P'], ['B','Y','G','P'], ['P','Y','G','B'], ['P','B','G','Y'], ['B','P','G','Y']];
    const scores = orders.map((o) => weightedPositionSteps(o, DEFAULT_CONFIG.positionStepWeights) * 0.25);
    for (const s of scores) expect(s % 0.25).toBe(0);
  });
  test('mistakes, rainbows and failed games work as in model D', () => {
    expect(scoreQ(make([MISTAKE, RAINBOW, P, B, G, Y]))).toBe(10 - 1 - 0.5 + 3.75);
    expect(scoreQ(make([P, MISTAKE, MISTAKE, MISTAKE, MISTAKE]))).toBe(4 - 4 + 3);
  });
  test('the unit is configurable', () => {
    expect(scoreQ(make([P, B, G, Y]), { ...DEFAULT_CONFIG, weightedPositionBonusPerUnit: 0.5 })).toBe(17.5);
    expect(scoreQ(make([P, B, G, Y]), { ...DEFAULT_CONFIG, weightedPositionBonusPerUnit: 0 })).toBe(10);
  });
  test('the per-category step weights are configurable', () => {
    const cfg = { ...DEFAULT_CONFIG, positionStepWeights: { Y: 0, G: 1, B: 2, P: 3 } };
    expect(scoreQ(make([P, B, G, Y]), cfg)).toBe(10 + 11 * 0.25); // P 3×3 + B 1×2
  });
});

describe('resolveModels: choosing models from a command-line value', () => {
  const ids = (v?: string) => resolveModels(v).map((m) => m.id);

  test('defaults to the scored models D, P, Q and R', () => {
    expect(ids(undefined)).toEqual(['D', 'P', 'Q', 'R']);
  });
  test('accepts one model, case-insensitively', () => {
    expect(ids('p')).toEqual(['P']);
  });
  test('accepts a comma-separated list in the order given', () => {
    expect(ids('B,Q')).toEqual(['B', 'Q']);
    expect(ids('Q, d')).toEqual(['Q', 'D']);
  });
  test('"all" means every model', () => {
    expect(ids('all')).toEqual(['B', 'D', 'P', 'Q', 'R']);
  });
  test('an unknown model is rejected with a helpful message', () => {
    expect(() => resolveModels('X')).toThrow(/unknown model "X"/i);
  });
});
