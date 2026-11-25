import { describe, expect, test } from 'bun:test';
import { rescoreAll } from '../rescore';
import type { StoredResult } from '../db/types';
import { MISTAKE, NATURAL, B, G, P, Y, makeShare, memoryDb } from './support';

type Db = Awaited<ReturnType<typeof memoryDb>>;
const none = new Set<string>();

/** Store a share the way the OLD scoring left it: an explicit old score and old win/tie flags. */
async function seed(db: Db, id: string, rows: string[], puzzle: number, oldScore: number) {
  const share = makeShare(rows, puzzle);
  const result: StoredResult = {
    discordId: id,
    puzzleNumber: puzzle,
    guessRows: share.guesses.map((g) => g.colors.join('')),
    solvedOrder: share.solvedOrder,
    mistakes: share.mistakes,
    rainbows: share.rainbows,
    failed: share.failed,
    postedAt: '2026-01-01T00:00:00.000Z',
  };
  await db.upsertPlayer(id, `name-${id}`);
  await db.saveResult(result, oldScore);
}
const flags = async (db: Db, puzzle: number) =>
  Object.fromEntries((await db.getPuzzleEntries(puzzle)).map((e) => [e.discordId, [e.dailyScore, e.isWin, e.isTie]]));

/** The case that prompted the change: Clarkio (1 mistake, natural) lost to RuggMatt (3 mistakes, GBPY) under the old scoring. */
async function clarkioVsRuggmatt(db: Db, puzzle = 1259) {
  await seed(db, 'clarkio', [MISTAKE, ...NATURAL], puzzle, 9);
  await seed(db, 'ruggmatt', [G, B, MISTAKE, MISTAKE, MISTAKE, P, Y], puzzle, 9.25);
  await db.setOutcomes(puzzle, [{ discordId: 'clarkio', isWin: false, isTie: false }, { discordId: 'ruggmatt', isWin: true, isTie: false }]);
}

describe('rescoreAll', () => {
  test('a dry run reports what would change and writes nothing', async () => {
    const db = await memoryDb();
    await clarkioVsRuggmatt(db);
    const summary = await rescoreAll(db, none, { apply: false });
    expect(summary).toMatchObject({ applied: false, puzzles: 1, results: 2, scoresChanged: 2, winnerChanged: 1 });
    expect(await flags(db, 1259)).toEqual({ clarkio: [9, false, false], ruggmatt: [9.25, true, false] });
  });

  test('applying rewrites every score and the win flags with the live scoring', async () => {
    const db = await memoryDb();
    await clarkioVsRuggmatt(db);
    const summary = await rescoreAll(db, none, { apply: true });
    expect(summary).toMatchObject({ applied: true, scoresChanged: 2, winnerChanged: 1 });
    expect(await flags(db, 1259)).toEqual({ clarkio: [30, true, false], ruggmatt: [14.5, false, false] });
  });

  test('running it again changes nothing', async () => {
    const db = await memoryDb();
    await clarkioVsRuggmatt(db);
    await rescoreAll(db, none, { apply: true });
    const again = await rescoreAll(db, none, { apply: true });
    expect(again).toMatchObject({ scoresChanged: 0, winnerChanged: 0 });
    expect(await flags(db, 1259)).toEqual({ clarkio: [30, true, false], ruggmatt: [14.5, false, false] });
  });

  test('before and after single-winner and tie counts, over puzzles with two or more players', async () => {
    const db = await memoryDb();
    await clarkioVsRuggmatt(db, 1000); // single winner before, single winner after
    // puzzle 1001: tied before (equal old scores), single after (a mistake apart)
    await seed(db, 'a', NATURAL, 1001, 14);
    await seed(db, 'b', [MISTAKE, ...NATURAL], 1001, 14);
    await db.setOutcomes(1001, [{ discordId: 'a', isWin: false, isTie: true }, { discordId: 'b', isWin: false, isTie: true }]);
    // puzzle 1002: only one player, so not contested
    await seed(db, 'a', NATURAL, 1002, 14);
    await db.setOutcomes(1002, [{ discordId: 'a', isWin: true, isTie: false }]);

    const s = await rescoreAll(db, none, { apply: false });
    expect(s.puzzles).toBe(3);
    expect(s.before).toEqual({ contested: 2, singleWinner: 1, tied: 1 });
    expect(s.after).toEqual({ contested: 2, singleWinner: 2, tied: 0 });
    expect(s.winnerChanged).toBe(2);
  });

  test('ignored players get new scores but never count toward winners or ties', async () => {
    const db = await memoryDb();
    await seed(db, 'u1', [MISTAKE, ...NATURAL], 1000, 9);
    await seed(db, 'ign', [P, B, G, Y], 1000, 17.75);
    await db.setOutcomes(1000, [{ discordId: 'u1', isWin: false, isTie: false }, { discordId: 'ign', isWin: false, isTie: false }]);
    await rescoreAll(db, new Set(['ign']), { apply: true });
    expect(await flags(db, 1000)).toEqual({ ign: [53.5, false, false], u1: [30, true, false] });
  });

  test('leaves raw results, players and opt-in alone', async () => {
    const db = await memoryDb();
    await clarkioVsRuggmatt(db);
    await db.setOptedIn('clarkio', true);
    const before = (await db.getPuzzleEntries(1259)).map((e) => e.result);
    await rescoreAll(db, none, { apply: true });
    expect((await db.getPuzzleEntries(1259)).map((e) => e.result)).toEqual(before);
    expect((await db.getPlayer('clarkio'))!.isOptedIn).toBe(true);
    expect((await db.getPlayer('ruggmatt'))!.discordName).toBe('name-ruggmatt');
  });

  test('an empty database is fine', async () => {
    const s = await rescoreAll(await memoryDb(), none, { apply: true });
    expect(s).toMatchObject({ puzzles: 0, results: 0, scoresChanged: 0, winnerChanged: 0 });
  });

  test('reports progress through a callback, one call per puzzle in order', async () => {
    const db = await memoryDb();
    await seed(db, 'a', NATURAL, 1001, 14);
    await seed(db, 'a', NATURAL, 1000, 14);
    const seen: number[] = [];
    await rescoreAll(db, none, { apply: false, onPuzzle: (n) => seen.push(n) });
    expect(seen).toEqual([1000, 1001]);
  });
});
