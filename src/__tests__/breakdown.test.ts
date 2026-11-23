import { describe, expect, test } from 'bun:test';
import { pickExamples, formatExample } from '../analysis/examples';
import { groupByPuzzle, type HistoryRecord } from '../analysis/history';
import { parseShare } from '../connections/parser';
import type { Share } from '../connections/types';
import { DEFAULT_CONFIG } from '../scoring/config';
import { modelB, modelD, modelP, modelQ } from '../scoring/models';

const Y = '🟨🟨🟨🟨', G = '🟩🟩🟩🟩', B = '🟦🟦🟦🟦', P = '🟪🟪🟪🟪';
const MISTAKE = '🟨🟨🟨🟩', RAINBOW = '🟨🟩🟦🟪';
const make = (rows: string[]): Share => {
  const r = parseShare(`Connections\nPuzzle #1\n${rows.join('\n')}`);
  if (r?.status !== 'ok') throw new Error('bad fixture');
  return r.share;
};

const SHARES: Record<string, Share> = {
  natural: make([Y, G, B, P]),
  hardestFirst: make([P, B, G, Y]),
  withMistake: make([MISTAKE, P, B, G, Y]),
  withRainbows: make([RAINBOW, RAINBOW, Y, G, B, P]),
  failedPartial: make([P, MISTAKE, MISTAKE, MISTAKE, MISTAKE]),
  failedNothing: make([MISTAKE, MISTAKE, MISTAKE, MISTAKE]),
};
const CONFIGS = [
  DEFAULT_CONFIG,
  { ...DEFAULT_CONFIG, orderBonusPerPair: 0.25, positionBonusPerStep: 0.1, weightedPositionBonusPerUnit: 0.5, rainbowPenalty: 1 },
];

describe('breakdown adds up to the daily score', () => {
  for (const model of [modelD, modelP, modelQ]) {
    test(`model ${model.id}: components sum to the score for every share and config`, () => {
      for (const cfg of CONFIGS) {
        for (const share of Object.values(SHARES)) {
          const sum = model.breakdown!(share, cfg).reduce((t, c) => t + c.points, 0);
          expect(sum).toBeCloseTo(model.rankKey(share, cfg)[0]!, 10);
        }
      }
    });
  }

  test('model B has no breakdown because it has no score to explain', () => {
    expect(modelB.breakdown).toBeUndefined();
  });
});

describe('breakdown components', () => {
  const by = (model: typeof modelQ, share: Share) =>
    Object.fromEntries(model.breakdown!(share, DEFAULT_CONFIG).map((c) => [c.label, c]));

  test('categories are listed with their weights', () => {
    const c = by(modelD, SHARES.natural!).categories!;
    expect(c.points).toBe(10);
    expect(c.detail).toBe('🟨+1 🟩+2 🟦+3 🟪+4');
  });

  test('mistakes and rainbows appear only when there are some, as negative points', () => {
    expect(by(modelD, SHARES.natural!).mistakes).toBeUndefined();
    expect(by(modelD, SHARES.withMistake!).mistakes).toMatchObject({ points: -1, detail: '1 × -1' });
    expect(by(modelD, SHARES.withRainbows!).rainbows).toMatchObject({ points: -1, detail: '2 × -0.5' });
  });

  test('model D explains its pair bonus by listing the pairs', () => {
    const b = by(modelD, SHARES.hardestFirst!)['order bonus']!;
    expect(b.points).toBe(3);
    expect(b.detail).toContain('6 pairs × 0.5');
    expect(b.detail).toContain('🟪 before 🟨');
  });

  test('model P explains its position bonus per category', () => {
    const b = by(modelP, SHARES.hardestFirst!)['position bonus']!;
    expect(b.points).toBe(1);
    expect(b.detail).toContain('🟪 solved 1st: 3 steps');
    expect(b.detail).toContain('🟦 solved 2nd: 1 step');
    expect(b.detail).toContain('4 steps × 0.25');
  });

  test('model Q explains its weighted position bonus per category', () => {
    const b = by(modelQ, SHARES.hardestFirst!)['position bonus']!;
    expect(b.points).toBe(3.75);
    expect(b.detail).toContain('🟪 solved 1st: 3 steps × 4 = 12');
    expect(b.detail).toContain('🟦 solved 2nd: 1 step × 3 = 3');
    expect(b.detail).toContain('15 units × 0.25');
  });

  test('no bonus component when nothing earned it', () => {
    expect(by(modelQ, SHARES.natural!)['position bonus']).toBeUndefined();
  });
});

describe('breakdown in the examples', () => {
  const L: Record<string, string> = { '🟨': 'Y', '🟩': 'G', '🟦': 'B', '🟪': 'P' };
  const rec = (h: string, rows: string[]): HistoryRecord => ({
    playerHash: h, puzzleNumber: 1, postedAt: '2026-01-01T00:00:00Z',
    rows: rows.map((r) => Array.from(r).map((c) => L[c]).join('')),
  });
  const groups = groupByPuzzle([rec('aaaaaaaa', [MISTAKE, P, B, G, Y]), rec('bbbbbbbb', [Y, G, B, P])]);

  test('a scored model shows each player\'s breakdown under their score', () => {
    const ex = pickExamples(groups, modelQ, DEFAULT_CONFIG, 1).clearWinner[0]!;
    const text = formatExample(ex, modelQ);
    expect(text).toContain('score 12.75');
    expect(text).toContain('categories +10 (🟨+1 🟩+2 🟦+3 🟪+4)');
    expect(text).toContain('mistakes -1 (1 × -1)');
    expect(text).toContain('position bonus +3.75');
  });

  test('model B keeps its rank-key line and adds no breakdown', () => {
    const ex = pickExamples(groups, modelB, DEFAULT_CONFIG, 1).clearWinner[0]!;
    expect(formatExample(ex, modelB)).not.toContain('categories +');
  });
});

describe('breakdown text uses colour squares, not letters', () => {
  const text = (model: typeof modelQ, share: Share) =>
    model.breakdown!(share, DEFAULT_CONFIG).map((c) => c.detail).join(' | ');

  test('solved categories, in the order they were solved', () => {
    expect(text(modelQ, SHARES.hardestFirst!)).toContain('🟪+4 🟦+3 🟩+2 🟨+1');
  });

  test('position bonus names each category that moved up with its square', () => {
    const t = text(modelQ, SHARES.hardestFirst!);
    expect(t).toContain('🟪 solved 1st: 3 steps × 4 = 12');
    expect(t).toContain('🟦 solved 2nd: 1 step × 3 = 3');
  });

  test('no colour letters are left in any breakdown detail', () => {
    for (const model of [modelD, modelP, modelQ]) {
      for (const share of Object.values(SHARES)) {
        expect(text(model, share)).not.toMatch(/(^|[\s(])[YGBP]([+\s])/);
      }
    }
  });
});
