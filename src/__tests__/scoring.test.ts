import { describe, expect, test } from 'bun:test';
import { parseShare } from '../connections/parser';
import type { Share } from '../connections/types';
import { DEFAULT_CONFIG } from '../scoring/config';
import { compareKeys, modelB, modelD, orderPairs } from '../scoring/models';
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
