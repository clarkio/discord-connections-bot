import { describe, expect, test } from 'bun:test';
import type { StoredResult } from '../db/types';
import { memoryDb } from './support';

const result = (discordId: string, puzzleNumber: number, over: Partial<StoredResult> = {}): StoredResult => ({
  discordId,
  puzzleNumber,
  guessRows: ['YYYY', 'GGGG', 'BBBB', 'PPPP'],
  solvedOrder: ['Y', 'G', 'B', 'P'],
  mistakes: 0,
  rainbows: 0,
  failed: false,
  postedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('players and opt-in', () => {
  test('a new player is opted out by default', async () => {
    const db = await memoryDb();
    await db.upsertPlayer('u1', 'alice');
    expect(await db.getPlayer('u1')).toEqual({ discordId: 'u1', discordName: 'alice', isOptedIn: false });
  });

  test('upserting again keeps one player and updates the name', async () => {
    const db = await memoryDb();
    await db.upsertPlayer('u1', 'alice');
    await db.upsertPlayer('u1', 'alice2');
    expect((await db.getPlayer('u1'))!.discordName).toBe('alice2');
  });

  test('upserting does not reset opt-in', async () => {
    const db = await memoryDb();
    await db.upsertPlayer('u1', 'alice');
    await db.setOptedIn('u1', true);
    await db.upsertPlayer('u1', 'alice2');
    expect((await db.getPlayer('u1'))!.isOptedIn).toBe(true);
  });

  test('setOptedIn reports whether anything changed', async () => {
    const db = await memoryDb();
    await db.upsertPlayer('u1', 'alice');
    expect(await db.setOptedIn('u1', true)).toBe(true);
    expect(await db.setOptedIn('u1', true)).toBe(false);
    expect(await db.setOptedIn('u1', false)).toBe(true);
    expect(await db.setOptedIn('u1', false)).toBe(false);
  });

  test('an unknown player is undefined', async () => {
    expect(await (await memoryDb()).getPlayer('nobody')).toBeUndefined();
  });
});

describe('results and scores', () => {
  test('a result round-trips, and the score is kept in a separate table', async () => {
    const db = await memoryDb();
    await db.upsertPlayer('u1', 'alice');
    const r = result('u1', 1000, { mistakes: 1, solvedOrder: ['P', 'B', 'G', 'Y'], guessRows: ['YYYG', 'PPPP', 'BBBB', 'GGGG', 'YYYY'] });
    expect(await db.saveResult(r, 9.5)).toBe(true);

    const [entry] = await db.getPuzzleEntries(1000);
    expect(entry!.result).toEqual(r);
    expect(entry!.dailyScore).toBe(9.5);
    expect(entry!.discordName).toBe('alice');
    expect(entry!.isWin).toBe(false);
    expect(entry!.isTie).toBe(false);

    const raw = await db.rawQuery('select * from results');
    expect(Object.keys(raw[0]!)).not.toContain('daily_score');
    expect((await db.rawQuery('select daily_score from scores'))[0]!.daily_score).toBe(9.5);
  });

  test('the first result per player and puzzle is kept; a second is refused and changes nothing', async () => {
    const db = await memoryDb();
    await db.upsertPlayer('u1', 'alice');
    expect(await db.saveResult(result('u1', 1000), 14)).toBe(true);
    expect(await db.saveResult(result('u1', 1000, { mistakes: 1 }), 9)).toBe(false);
    const entries = await db.getPuzzleEntries(1000);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.dailyScore).toBe(14);
    expect(await db.hasResult('u1', 1000)).toBe(true);
    expect(await db.hasResult('u1', 1001)).toBe(false);
  });

  test('setOutcomes records wins and ties for a puzzle', async () => {
    const db = await memoryDb();
    for (const id of ['u1', 'u2']) {
      await db.upsertPlayer(id, id);
      await db.saveResult(result(id, 1000), 14);
    }
    await db.setOutcomes(1000, [{ discordId: 'u1', isWin: false, isTie: true }, { discordId: 'u2', isWin: false, isTie: true }]);
    const entries = await db.getPuzzleEntries(1000);
    expect(entries.every((e) => e.isTie && !e.isWin)).toBe(true);
  });

  test('getPlayerEntries returns a player\'s history newest puzzle first, whether or not they are opted in', async () => {
    const db = await memoryDb();
    await db.upsertPlayer('u1', 'alice');
    for (const n of [998, 1000, 999]) await db.saveResult(result('u1', n), 14);
    expect((await db.getPlayerEntries('u1')).map((e) => e.result.puzzleNumber)).toEqual([1000, 999, 998]);
  });
});

describe('public leaderboard data respects opt-in', () => {
  test('only opted-in players appear, with totals, average, wins and ties', async () => {
    const db = await memoryDb();
    for (const [id, name] of [['u1', 'alice'], ['u2', 'bob']] as const) await db.upsertPlayer(id, name);
    await db.saveResult(result('u1', 1), 14);
    await db.saveResult(result('u1', 2), 10);
    await db.saveResult(result('u2', 1), 9);
    await db.setOutcomes(1, [{ discordId: 'u1', isWin: true, isTie: false }, { discordId: 'u2', isWin: false, isTie: false }]);
    await db.setOutcomes(2, [{ discordId: 'u1', isWin: false, isTie: true }]);

    expect(await db.getPublicLeaderboard()).toEqual([]);

    await db.setOptedIn('u1', true);
    expect(await db.getPublicLeaderboard()).toEqual([
      { discordName: 'alice', games: 2, totalScore: 24, averageScore: 12, wins: 1, ties: 1 },
    ]);
  });
});
