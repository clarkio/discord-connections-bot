import { describe, expect, test } from 'bun:test';
import { buildRecords, groupByPuzzle, type HistoryRecord } from '../analysis/history';
import { ORDER_BONUS_GRID, RAINBOW_PENALTY_GRID, analyze, sweep } from '../analysis/metrics';
import { DEFAULT_CONFIG } from '../scoring/config';
import { modelB, modelD } from '../scoring/models';

const PERFECT = ['🟨🟨🟨🟨', '🟩🟩🟩🟩', '🟦🟦🟦🟦', '🟪🟪🟪🟪'];
const ONE_MISTAKE = ['🟨🟨🟨🟩', ...PERFECT];
const FAIL = ['🟨🟨🟩🟩', '🟨🟨🟦🟦', '🟪🟪🟩🟩', '🟦🟪🟦🟪'];

// Exported records store rows as colour letters (e.g. 'YYYY'), not emoji.
const LETTER: Record<string, string> = { '🟨': 'Y', '🟩': 'G', '🟦': 'B', '🟪': 'P' };
const rec = (playerHash: string, puzzleNumber: number, rows: string[], postedAt = '2026-01-01T00:00:00Z'): HistoryRecord => ({
  playerHash,
  puzzleNumber,
  rows: rows.map((r) => Array.from(r).map((c) => LETTER[c]).join('')),
  postedAt,
});

describe('buildRecords', () => {
  const msg = (id: string, content: string, bot = false) => ({
    authorId: id,
    authorIsBot: bot,
    content,
    createdAt: '2026-01-01T00:00:00Z',
  });
  const text = (rows: string[], n = 7) => `Connections\nPuzzle #${n}\n${rows.join('\n')}`;

  test('keeps valid shares, drops chatter, bots and invalid shares, and counts what it dropped', () => {
    const { records, skipped } = buildRecords(
      [msg('a', text(PERFECT)), msg('b', 'hello'), msg('c', text(PERFECT), true), msg('d', 'Connections\nPuzzle #7\n🟨🟨🟨🟨')],
      'salt',
    );
    expect(records).toHaveLength(1);
    expect(skipped).toEqual({ notShares: 1, bots: 1, invalid: 1 });
  });

  test('never exposes the Discord id or the free text, and hashes consistently per salt', () => {
    const { records } = buildRecords([msg('12345', `lol ${text(PERFECT)}`), msg('12345', text(PERFECT, 8))], 'salt');
    expect(JSON.stringify(records)).not.toContain('12345');
    expect(JSON.stringify(records)).not.toContain('lol');
    expect(records[0]!.playerHash).toBe(records[1]!.playerHash);
    const other = buildRecords([msg('12345', text(PERFECT))], 'other-salt').records;
    expect(other[0]!.playerHash).not.toBe(records[0]!.playerHash);
  });
});

describe('groupByPuzzle', () => {
  test('first share per player and puzzle wins, by posted time', () => {
    const groups = groupByPuzzle([
      rec('a', 1, ONE_MISTAKE, '2026-01-01T09:00:00Z'),
      rec('a', 1, PERFECT, '2026-01-01T08:00:00Z'),
    ]);
    const entries = groups.get(1)!;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.share.mistakes).toBe(0);
  });
});

describe('analyze', () => {
  const groups = groupByPuzzle([
    // puzzle 1: clear winner
    rec('a', 1, PERFECT), rec('b', 1, ONE_MISTAKE),
    // puzzle 2: tie
    rec('a', 2, PERFECT), rec('b', 2, PERFECT),
    // puzzle 3: everyone fails identically
    rec('a', 3, FAIL), rec('b', 3, FAIL),
    // puzzle 4: only one player, excluded from rates
    rec('a', 4, PERFECT),
  ]);

  test('reports the four metrics over puzzles with two or more players', () => {
    const m = analyze(groups, modelD, DEFAULT_CONFIG);
    expect(m.puzzles).toBe(3);
    expect(m.singleWinnerRate).toBeCloseTo(1 / 3);
    expect(m.avgWinnerGroupSize).toBeCloseTo((1 + 2 + 2) / 3);
    expect(m.allTiedRate).toBeCloseTo(2 / 3);
    expect(m.avgMargin).toBeCloseTo((1 + 0 + 0) / 3);
  });

  test('model B has no numeric scale, so its margin is not reported', () => {
    expect(analyze(groups, modelB, DEFAULT_CONFIG).avgMargin).toBeNull();
  });

  test('empty history yields zero puzzles and no NaN', () => {
    const m = analyze(new Map(), modelD, DEFAULT_CONFIG);
    expect(m.puzzles).toBe(0);
    expect(m.singleWinnerRate).toBe(0);
  });
});

describe('sweep', () => {
  test('runs each parameter combination and labels it', () => {
    const groups = groupByPuzzle([rec('a', 1, PERFECT), rec('b', 1, ONE_MISTAKE)]);
    const rows = sweep(groups, modelD);
    expect(rows.length).toBe(ORDER_BONUS_GRID.length * RAINBOW_PENALTY_GRID.length);
    expect(rows[0]!.label).toContain('orderBonus');
    expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
  });

  test('the order-bonus grid includes values finer than 0.25 and ones that do not line up with the penalties', () => {
    for (const v of [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.5, 1]) expect(ORDER_BONUS_GRID).toContain(v);
  });
});
