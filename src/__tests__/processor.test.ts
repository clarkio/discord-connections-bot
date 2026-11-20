import { describe, expect, test } from 'bun:test';
import { formatAnnouncement, processShare } from '../processor';
import { MISTAKE, NATURAL, B, G, P, Y, makeShare, memoryDb } from './support';

const none = new Set<string>();
const author = (id: string, name = id) => ({ id, username: name });
const at = new Date('2026-01-01T00:00:00Z');

async function run(db: Awaited<ReturnType<typeof memoryDb>>, id: string, rows: string[], opts: { puzzle?: number; ignored?: Set<string> } = {}) {
  return processShare(makeShare(rows, opts.puzzle ?? 1000), author(id), at, db, opts.ignored ?? none);
}

describe('processShare', () => {
  test('the first share stores the raw result and the production score, and wins', async () => {
    const db = await memoryDb();
    const out = await run(db, 'u1', NATURAL);
    expect(out.status).toBe('saved');
    if (out.status !== 'saved') throw new Error();
    expect(out.dailyScore).toBe(14);
    expect(out.winners.map((w) => w.discordId)).toEqual(['u1']);
    expect(out.isTie).toBe(false);
    expect(out.announce).toBe(true);

    const [e] = await db.getPuzzleEntries(1000);
    expect(e).toMatchObject({ dailyScore: 14, isWin: true, isTie: false });
    expect(e!.result.guessRows).toEqual(['YYYY', 'GGGG', 'BBBB', 'PPPP']);
    expect(e!.result.postedAt).toBe(at.toISOString());
  });

  test('a better share takes over, and the previous winner\'s flag is cleared', async () => {
    const db = await memoryDb();
    await run(db, 'u1', [MISTAKE, ...NATURAL]);
    const out = await run(db, 'u2', NATURAL);
    if (out.status !== 'saved') throw new Error();
    expect(out.winners.map((w) => w.discordId)).toEqual(['u2']);
    expect(out.announce).toBe(true);
    const flags = Object.fromEntries((await db.getPuzzleEntries(1000)).map((e) => [e.discordId, [e.isWin, e.isTie]]));
    expect(flags).toEqual({ u1: [false, false], u2: [true, false] });
  });

  test('a worse share does not change the winner and is not announced', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    const out = await run(db, 'u2', [MISTAKE, ...NATURAL]);
    if (out.status !== 'saved') throw new Error();
    expect(out.winners.map((w) => w.discordId)).toEqual(['u1']);
    expect(out.announce).toBe(false);
  });

  test('equal scores tie, both flagged as ties, and the new sharer is announced', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    const out = await run(db, 'u2', NATURAL);
    if (out.status !== 'saved') throw new Error();
    expect(out.isTie).toBe(true);
    expect(out.winners.map((w) => w.discordId).sort()).toEqual(['u1', 'u2']);
    expect(out.announce).toBe(true);
    expect((await db.getPuzzleEntries(1000)).every((e) => e.isTie && !e.isWin)).toBe(true);
  });

  test('a tie that becomes a win clears the tie flags', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    await run(db, 'u2', NATURAL);
    await run(db, 'u3', [P, B, G, Y]);
    const flags = Object.fromEntries((await db.getPuzzleEntries(1000)).map((e) => [e.discordId, [e.isWin, e.isTie]]));
    expect(flags).toEqual({ u1: [false, false], u2: [false, false], u3: [true, false] });
  });

  test('a duplicate share is ignored: nothing changes and nothing is announced', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    const out = await run(db, 'u1', [MISTAKE, ...NATURAL]);
    expect(out.status).toBe('duplicate');
    const entries = await db.getPuzzleEntries(1000);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.dailyScore).toBe(14);
  });

  test('a first-ever share for an older puzzle is accepted and decided within that puzzle only', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL, { puzzle: 1000 });
    const out = await run(db, 'u2', [MISTAKE, ...NATURAL], { puzzle: 990 });
    if (out.status !== 'saved') throw new Error();
    expect(out.puzzleNumber).toBe(990);
    expect(out.announce).toBe(true); // alone on puzzle 990, so currently winning it
    expect((await db.getPuzzleEntries(1000))[0]!.isWin).toBe(true);
  });

  test('an ignored player is saved but never counts toward winners or ties, and is never announced', async () => {
    const db = await memoryDb();
    const ignored = new Set(['bot-pal']);
    await run(db, 'u1', [MISTAKE, ...NATURAL], { ignored });
    const out = await run(db, 'bot-pal', [P, B, G, Y], { ignored });
    if (out.status !== 'saved') throw new Error();
    expect(out.winners.map((w) => w.discordId)).toEqual(['u1']);
    expect(out.announce).toBe(false);
    const entries = Object.fromEntries((await db.getPuzzleEntries(1000)).map((e) => [e.discordId, e]));
    expect(entries['bot-pal']!.dailyScore).toBe(17.75);
    expect(entries['bot-pal']).toMatchObject({ isWin: false, isTie: false });
    expect(entries.u1).toMatchObject({ isWin: true, isTie: false });
  });

  test('only ignored players have shared: no winners', async () => {
    const db = await memoryDb();
    const out = await run(db, 'x', NATURAL, { ignored: new Set(['x']) });
    if (out.status !== 'saved') throw new Error();
    expect(out.winners).toEqual([]);
    expect(out.announce).toBe(false);
  });

  test('everyone failing with the same score is a tie', async () => {
    const db = await memoryDb();
    const fail = [MISTAKE, MISTAKE, MISTAKE, MISTAKE];
    await run(db, 'u1', fail);
    const out = await run(db, 'u2', fail);
    if (out.status !== 'saved') throw new Error();
    expect(out.isTie).toBe(true);
    expect(out.announce).toBe(true);
  });

  test('a lone failed player is still announced as the winner', async () => {
    const db = await memoryDb();
    const out = await run(db, 'u1', [MISTAKE, MISTAKE, MISTAKE, MISTAKE]);
    if (out.status !== 'saved') throw new Error();
    expect(out.winners.map((w) => w.discordId)).toEqual(['u1']);
    expect(out.announce).toBe(true);
  });

  test('the player\'s latest name is kept', async () => {
    const db = await memoryDb();
    await processShare(makeShare(NATURAL), author('u1', 'old'), at, db, none);
    await processShare(makeShare(NATURAL, 1001), author('u1', 'new'), at, db, none);
    expect((await db.getPlayer('u1'))!.discordName).toBe('new');
  });

});

describe('formatAnnouncement', () => {
  async function outcomeFor(...rowsPerPlayer: string[][]) {
    const db = await memoryDb();
    let last;
    for (const [i, rows] of rowsPerPlayer.entries()) last = await run(db, `u${i + 1}`, rows);
    if (last?.status !== 'saved') throw new Error();
    return last;
  }

  test('single winner, tagged', async () => {
    const out = await outcomeFor([MISTAKE, ...NATURAL], NATURAL);
    expect(formatAnnouncement(out, true)).toBe('Current Winner for Connections #1000 with 14 points (solved 4/4, 0 mistakes): <@u2>');
  });

  test('single winner, names instead of tags', async () => {
    const out = await outcomeFor(NATURAL);
    expect(formatAnnouncement(out, false)).toBe('Current Winner for Connections #1000 with 14 points (solved 4/4, 0 mistakes): u1');
  });

  test('a tie names everyone', async () => {
    const out = await outcomeFor(NATURAL, NATURAL);
    expect(formatAnnouncement(out, true)).toBe('Current Winners (tie) for Connections #1000 with 14 points: <@u1>, <@u2>');
  });

  test('a failed winner says how far they got, with singular and plural wording', async () => {
    const out = await outcomeFor([Y, MISTAKE, MISTAKE, MISTAKE, MISTAKE]);
    expect(formatAnnouncement(out, true)).toBe('Current Winner for Connections #1000 with -3 points (solved 1/4, 4 mistakes): <@u1>');
    const one = await outcomeFor([MISTAKE, ...NATURAL]);
    expect(formatAnnouncement(one, true)).toContain('1 mistake):');
  });
});
