import { describe, expect, test } from 'bun:test';
import { formatExample, pickExamples } from '../analysis/examples';
import { groupByPuzzle, type HistoryRecord } from '../analysis/history';
import { DEFAULT_CONFIG } from '../scoring/config';
import { modelB, modelD } from '../scoring/models';

const L: Record<string, string> = { '🟨': 'Y', '🟩': 'G', '🟦': 'B', '🟪': 'P' };
const PERFECT = ['🟨🟨🟨🟨', '🟩🟩🟩🟩', '🟦🟦🟦🟦', '🟪🟪🟪🟪'];
const ONE_MISTAKE = ['🟨🟨🟨🟩', ...PERFECT];
const rec = (h: string, n: number, rows: string[], t = '2026-01-01T00:00:00Z'): HistoryRecord => ({
  playerHash: h,
  puzzleNumber: n,
  rows: rows.map((r) => Array.from(r).map((c) => L[c]).join('')),
  postedAt: t,
});

const groups = groupByPuzzle([
  rec('aaaaaaaa', 1, PERFECT), rec('bbbbbbbb', 1, ONE_MISTAKE), // clear winner
  rec('aaaaaaaa', 2, PERFECT), rec('bbbbbbbb', 2, PERFECT), rec('cccccccc', 2, ONE_MISTAKE), // tie, not everyone
  rec('aaaaaaaa', 3, PERFECT), rec('bbbbbbbb', 3, PERFECT), // everyone tied
  rec('aaaaaaaa', 4, PERFECT), // one player: never an example
]);

describe('pickExamples', () => {
  const ex = pickExamples(groups, modelD, DEFAULT_CONFIG, 3);

  test('classifies puzzles as a clear winner, a tie, or everyone tied', () => {
    expect(ex.clearWinner.map((e) => e.puzzleNumber)).toEqual([1]);
    expect(ex.tie.map((e) => e.puzzleNumber)).toEqual([2]);
    expect(ex.allTied.map((e) => e.puzzleNumber)).toEqual([3]);
  });

  test('never uses one-player puzzles', () => {
    const all = [...ex.clearWinner, ...ex.tie, ...ex.allTied];
    expect(all.some((e) => e.puzzleNumber === 4)).toBe(false);
  });

  test('limits examples per kind', () => {
    expect(pickExamples(groups, modelD, DEFAULT_CONFIG, 0).clearWinner).toHaveLength(0);
  });

  test('lists players best first and marks winners', () => {
    const tie = ex.tie[0]!;
    expect(tie.players.map((p) => p.winner)).toEqual([true, true, false]);
  });
});

describe('formatExample', () => {
  test('shows the puzzle, each player hash short form, the guess rows, and the winner marker', () => {
    const text = formatExample(pickExamples(groups, modelD, DEFAULT_CONFIG, 1).clearWinner[0]!, modelD);
    expect(text).toContain('Puzzle #1');
    expect(text).toContain('aaaaaaaa');
    expect(text).toContain('🟨🟨🟨🟨 🟩🟩🟩🟩 🟦🟦🟦🟦 🟪🟪🟪🟪');
    expect(text).toContain('🏆');
    expect(text).toContain('score 10');
  });

  test('model B shows its rank key instead of a score', () => {
    const text = formatExample(pickExamples(groups, modelB, DEFAULT_CONFIG, 1).clearWinner[0]!, modelB);
    expect(text).not.toContain('score');
    expect(text).toContain('solved 4');
  });
});
