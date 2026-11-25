import { describe, expect, test } from 'bun:test';
import type { Color, Share } from '../connections/types';
import { DEFAULT_CONFIG } from '../scoring/config';
import { modelS } from '../scoring/models';
import { B, G, MISTAKE, NATURAL, P, RAINBOW, Y, makeShare } from './support';

const score = (rows: string[], cfg = DEFAULT_CONFIG) => modelS.rankKey(makeShare(rows), cfg)[0]!;

describe('model S: the live outcome scoring', () => {
  test('is a scored model', () => {
    expect(modelS.id).toBe('S');
    expect(modelS.scored).toBe(true);
  });

  test('clean games: 10 per group, +5 clean bonus, plus the position bonus', () => {
    expect(score(NATURAL)).toBe(45);
    expect(score([P, B, G, Y])).toBe(53.5); // perfect reverse: 17 units × 0.5 = 8.5, the highest possible
    expect(score([P, B, Y, G])).toBe(53); // almost reverse: 16 units
  });

  test('every mistake costs 10 and a rainbow guess is a mistake too', () => {
    expect(score([MISTAKE, ...NATURAL])).toBe(30);
    expect(score([MISTAKE, MISTAKE, ...NATURAL])).toBe(20);
    expect(score([MISTAKE, MISTAKE, MISTAKE, ...NATURAL])).toBe(10);
    expect(score([RAINBOW, MISTAKE, ...NATURAL])).toBe(20.25);
  });

  test('a rainbow grace of 0.25 is earned once per puzzle, however many rainbow guesses', () => {
    expect(score([RAINBOW, ...NATURAL])).toBe(30.25);
    expect(score([RAINBOW, RAINBOW, RAINBOW, ...NATURAL])).toBe(10.25); // 3 mistakes + one grace
    expect(score([MISTAKE, MISTAKE, MISTAKE, ...NATURAL])).toBe(10);
  });

  test('partially failed: 10 per group, 4 mistakes, and the position bonus for what was solved', () => {
    expect(score([Y, MISTAKE, MISTAKE, MISTAKE, MISTAKE])).toBe(-30);
    expect(score([P, MISTAKE, MISTAKE, MISTAKE, MISTAKE])).toBe(-25.5); // purple first: 9 units
    expect(score([G, B, MISTAKE, MISTAKE, MISTAKE, MISTAKE])).toBe(-18.5);
  });

  test('completely failed', () => {
    expect(score([MISTAKE, MISTAKE, MISTAKE, MISTAKE])).toBe(-40);
    expect(score([RAINBOW, MISTAKE, MISTAKE, MISTAKE])).toBe(-39.75);
  });

  test('the case that prompted this: three mistakes can no longer beat one', () => {
    const clarkio = score([MISTAKE, ...NATURAL]); // 1 mistake, natural order
    const ruggmatt = score([G, B, MISTAKE, MISTAKE, MISTAKE, P, Y]); // 3 mistakes, green blue purple yellow
    expect(clarkio).toBe(30);
    expect(ruggmatt).toBe(14.5);
    expect(clarkio).toBeGreaterThan(ruggmatt);
  });
});

describe('the rainbow grace is only a last tiebreak', () => {
  const rainbowNatural = () => score([RAINBOW, ...NATURAL]);
  const ordinaryReverse = () => score([MISTAKE, P, B, G, Y]);
  const rainbowReverse = () => score([RAINBOW, P, B, G, Y]);
  const ordinaryNatural = () => score([MISTAKE, ...NATURAL]);

  test('one mistake each: a better solve order beats a rainbow with a worse one', () => {
    expect(ordinaryReverse()).toBe(38.5);
    expect(rainbowNatural()).toBe(30.25);
    expect(ordinaryReverse()).toBeGreaterThan(rainbowNatural());
  });

  test('one mistake each and the same solve order: the rainbow wins', () => {
    expect(rainbowReverse()).toBe(38.75);
    expect(rainbowReverse()).toBeGreaterThan(ordinaryReverse());
    expect(rainbowNatural()).toBeGreaterThan(ordinaryNatural());
  });

  test('the grace is smaller than the smallest position step, so it can never outrank a better order', () => {
    expect(DEFAULT_CONFIG.outcome.rainbowGrace).toBeLessThan(DEFAULT_CONFIG.outcome.positionUnit);
  });

  test('two rainbows count as two mistakes, so one ordinary mistake beats them', () => {
    expect(score([MISTAKE, ...NATURAL])).toBeGreaterThan(score([RAINBOW, RAINBOW, ...NATURAL]));
  });

  test('turning the grace off removes the edge', () => {
    const cfg = { ...DEFAULT_CONFIG, outcome: { ...DEFAULT_CONFIG.outcome, rainbowGrace: 0 } };
    expect(score([RAINBOW, ...NATURAL], cfg)).toBe(score([MISTAKE, ...NATURAL], cfg));
  });
});

// ---- exhaustive check against an independent description of the ranking ----

const COLORS: Color[] = ['Y', 'G', 'B', 'P'];
const NATURAL_PLACE: Record<Color, number> = { Y: 1, G: 2, B: 3, P: 4 };
const STEP_WEIGHT: Record<Color, number> = { Y: 0, G: 1, B: 2, P: 3 };

function orders(k: number, pool: Color[] = COLORS): Color[][] {
  if (k === 0) return [[]];
  return pool.flatMap((c) => orders(k - 1, pool.filter((x) => x !== c)).map((rest) => [c, ...rest]));
}

interface Result {
  order: Color[];
  ordinary: number;
  rainbows: number;
}
const mistakes = (r: Result) => r.ordinary + r.rainbows;
const solvedAll = (r: Result) => r.order.length === 4;
const asShare = (r: Result): Share => ({
  puzzleNumber: 1, guesses: [], solvedOrder: r.order, mistakes: r.ordinary, rainbows: r.rainbows, failed: mistakes(r) === 4,
});

/** Position units, written out independently of the model code. */
function positionUnits(order: Color[]): number {
  let units = 0;
  order.forEach((c, i) => { units += Math.max(0, NATURAL_PLACE[c] - (i + 1)) * STEP_WEIGHT[c]; });
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) if (NATURAL_PLACE[order[i]!] > NATURAL_PLACE[order[j]!]) units++;
  return units;
}

/** Positive when a ranks better: solved everything, then (failed: groups), fewer mistakes, position bonus, rainbow grace. */
function reference(a: Result, b: Result): number {
  if (solvedAll(a) !== solvedAll(b)) return solvedAll(a) ? 1 : -1;
  if (!solvedAll(a) && a.order.length !== b.order.length) return a.order.length - b.order.length;
  if (mistakes(a) !== mistakes(b)) return mistakes(b) - mistakes(a);
  if (positionUnits(a.order) !== positionUnits(b.order)) return positionUnits(a.order) - positionUnits(b.order);
  return (a.rainbows > 0 ? 1 : 0) - (b.rainbows > 0 ? 1 : 0);
}

/** Every result the parser accepts: solved all four with up to 3 mistakes, or 4 mistakes with 0 to 3 groups solved. */
const ALL: Result[] = [];
for (let k = 0; k <= 4; k++) for (const order of orders(k)) for (let m = 0; m <= 4; m++) for (let r = 0; m + r <= 4; r++) {
  const total = m + r;
  if (total === 4 ? k <= 3 : k === 4) ALL.push({ order, ordinary: m, rainbows: r });
}

describe('exhaustive ranking check', () => {
  const scores = ALL.map((r) => modelS.rankKey(asShare(r), DEFAULT_CONFIG)[0]!);

  test('covers every possible result', () => {
    expect(ALL).toHaveLength(445);
  });

  test('for every pair of results, the higher score is exactly the better-ranked one, and equal means a tie', () => {
    let wrong = 0;
    for (let i = 0; i < ALL.length; i++) {
      for (let j = 0; j < ALL.length; j++) {
        if (Math.sign(reference(ALL[i]!, ALL[j]!)) !== Math.sign(scores[i]! - scores[j]!)) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });

  test('a clean game beats every game with a mistake', () => {
    const clean = ALL.flatMap((r, i) => (mistakes(r) === 0 ? [scores[i]!] : []));
    const rest = ALL.flatMap((r, i) => (mistakes(r) > 0 ? [scores[i]!] : []));
    expect(Math.min(...clean)).toBeGreaterThan(Math.max(...rest));
  });

  test('fewer mistakes always beats more, whatever the solve orders or rainbows', () => {
    for (let i = 0; i < ALL.length; i++) {
      for (let j = 0; j < ALL.length; j++) {
        if (solvedAll(ALL[i]!) && solvedAll(ALL[j]!) && mistakes(ALL[i]!) < mistakes(ALL[j]!)) expect(scores[i]!).toBeGreaterThan(scores[j]!);
      }
    }
  });

  test('the six outcome levels never overlap, worst to best', () => {
    const range = (f: (r: Result) => boolean) => {
      const s = ALL.flatMap((r, i) => (f(r) ? [scores[i]!] : []));
      return { min: Math.min(...s), max: Math.max(...s) };
    };
    const completely = range((r) => r.order.length === 0);
    const partially = range((r) => mistakes(r) === 4 && r.order.length > 0);
    const withMistakes = range((r) => solvedAll(r) && mistakes(r) > 0);
    const clean = range((r) => solvedAll(r) && mistakes(r) === 0);
    expect(completely.max).toBeLessThan(partially.min);
    expect(partially.max).toBeLessThan(withMistakes.min);
    expect(withMistakes.max).toBeLessThan(clean.min);
    expect(clean.max).toBe(53.5);
    expect(completely.min).toBe(-40);
  });

  test('the perfect reverse is the only way to reach the highest score', () => {
    const top = Math.max(...scores);
    const reaching = ALL.filter((_, i) => scores[i] === top);
    expect(reaching).toHaveLength(1);
    expect(reaching[0]!.order.join('')).toBe('PBGY');
  });

  test('partially failed games rank by groups solved first, then position, then grace', () => {
    const two = makeShare([G, B, MISTAKE, MISTAKE, MISTAKE, MISTAKE]);
    const oneBestOrder = makeShare([P, RAINBOW, MISTAKE, MISTAKE, MISTAKE]);
    expect(modelS.rankKey(two, DEFAULT_CONFIG)[0]!).toBeGreaterThan(modelS.rankKey(oneBestOrder, DEFAULT_CONFIG)[0]!);
  });
});

describe('score breakdown', () => {
  const parts = (rows: string[]) => modelS.breakdown!(makeShare(rows), DEFAULT_CONFIG);
  const line = (rows: string[], label: string) => parts(rows).find((c) => c.label === label);

  test('adds up to the score for every possible result', () => {
    for (const r of ALL) {
      const share = asShare(r);
      const sum = modelS.breakdown!(share, DEFAULT_CONFIG).reduce((t, c) => t + c.points, 0);
      expect(sum).toBeCloseTo(modelS.rankKey(share, DEFAULT_CONFIG)[0]!, 9);
    }
  });

  test('groups, in the order solved, with colour squares', () => {
    expect(line(NATURAL, 'groups')).toEqual({ label: 'groups', points: 40, detail: '🟨+10 🟩+10 🟦+10 🟪+10' });
    expect(line([P, MISTAKE, MISTAKE, MISTAKE, MISTAKE], 'groups')).toMatchObject({ points: 10, detail: '🟪+10' });
    expect(line([MISTAKE, MISTAKE, MISTAKE, MISTAKE], 'groups')).toEqual({ label: 'groups', points: 0, detail: 'none solved' });
  });

  test('mistakes appear only when there are some', () => {
    expect(line(NATURAL, 'mistakes')).toBeUndefined();
    expect(line([MISTAKE, MISTAKE, ...NATURAL], 'mistakes')).toEqual({ label: 'mistakes', points: -20, detail: '2 × -10' });
    expect(line([RAINBOW, ...NATURAL], 'mistakes')).toEqual({ label: 'mistakes', points: -10, detail: '1 × -10' });
  });

  test('position bonus explains the steps, the pairs and the units', () => {
    const bonus = line([MISTAKE, P, B, G, Y], 'position bonus')!;
    expect(bonus.points).toBe(8.5);
    expect(bonus.detail).toContain('🟪 solved 1st: 3 steps × 3 = 9');
    expect(bonus.detail).toContain('🟦 solved 2nd: 1 step × 2 = 2');
    expect(bonus.detail).toContain('6 harder-before-easier pairs');
    expect(bonus.detail).toContain('17 units × 0.5');
    expect(line(NATURAL, 'position bonus')).toBeUndefined();
  });

  test('rainbow grace only when a rainbow guess was made', () => {
    expect(line([RAINBOW, ...NATURAL], 'rainbow grace')).toEqual({ label: 'rainbow grace', points: 0.25, detail: 'a rainbow guess breaks ties' });
    expect(line([MISTAKE, ...NATURAL], 'rainbow grace')).toBeUndefined();
  });

  test('clean game bonus only with no mistakes', () => {
    expect(line(NATURAL, 'clean game bonus')).toEqual({ label: 'clean game bonus', points: 5, detail: 'no mistakes' });
    expect(line([MISTAKE, ...NATURAL], 'clean game bonus')).toBeUndefined();
    expect(line([RAINBOW, ...NATURAL], 'clean game bonus')).toBeUndefined();
  });
});
