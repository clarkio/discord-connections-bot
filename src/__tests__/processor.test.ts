import { describe, expect, test } from 'bun:test';
import { formatAnnouncement, formatShareReply, processShare } from '../processor';
import { MISTAKE, NATURAL, RAINBOW, B, G, P, Y, makeShare, memoryDb } from './support';

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

describe('processShare outcome', () => {
  test('carries the sharer\'s own entry, including when they are ignored', async () => {
    const db = await memoryDb();
    const out = await processShare(makeShare(NATURAL), author('u1', 'alice'), at, db, new Set(['u1']));
    if (out.status !== 'saved') throw new Error();
    expect(out.sharer).toMatchObject({ discordId: 'u1', discordName: 'alice', dailyScore: 14 });
  });
});

async function outcomeFor(...rowsPerPlayer: string[][]) {
  const db = await memoryDb();
  let last;
  for (const [i, rows] of rowsPerPlayer.entries()) last = await run(db, `u${i + 1}`, rows);
  if (last?.status !== 'saved') throw new Error();
  return last;
}

describe('formatAnnouncement', () => {
  test('single winner, tagged, with the score breakdown', async () => {
    const out = await outcomeFor([MISTAKE, ...NATURAL], NATURAL);
    expect(formatAnnouncement(out, true)).toBe(
      'Current Winner for Connections #1000 with 14 points (solved 4/4, 0 mistakes): <@u2>\n• categories +10 (Y+1 G+2 B+3 P+4)\n• clean game bonus +4 (no mistakes)',
    );
  });

  test('single winner, names instead of tags', async () => {
    const out = await outcomeFor(NATURAL);
    expect(formatAnnouncement(out, false)).toBe(
      'Current Winner for Connections #1000 with 14 points (solved 4/4, 0 mistakes): u1\n• categories +10 (Y+1 G+2 B+3 P+4)\n• clean game bonus +4 (no mistakes)',
    );
  });

  test('a tie names everyone, then gives each winner their own details', async () => {
    const out = await outcomeFor(NATURAL, NATURAL);
    expect(formatAnnouncement(out, true)).toBe(
      'Current Winners (tie) for Connections #1000 with 14 points: <@u1>, <@u2>\n' +
        '<@u1>: solved 4/4, 0 mistakes\n• categories +10 (Y+1 G+2 B+3 P+4)\n• clean game bonus +4 (no mistakes)\n' +
        '<@u2>: solved 4/4, 0 mistakes\n• categories +10 (Y+1 G+2 B+3 P+4)\n• clean game bonus +4 (no mistakes)',
    );
  });

  test('every tied winner gets their own breakdown lines', async () => {
    const out = await outcomeFor([P, B, G, Y], [P, B, G, Y]);
    const text = formatAnnouncement(out, true);
    expect(text.match(/• position bonus \+3\.75/g)).toHaveLength(2);
  });

  test('a failed winner says how far they got, with singular and plural wording', async () => {
    const out = await outcomeFor([Y, MISTAKE, MISTAKE, MISTAKE, MISTAKE]);
    expect(formatAnnouncement(out, true)).toBe(
      'Current Winner for Connections #1000 with -3 points (solved 1/4, 4 mistakes): <@u1>\n• categories +1 (Y+1)\n• mistakes -4 (4 × -1)',
    );
    const one = await outcomeFor([MISTAKE, ...NATURAL]);
    expect(formatAnnouncement(one, true)).toContain('1 mistake):');
  });

  test('a large tie is cut to fit Discord\'s message limit, still naming every winner', async () => {
    const out = await outcomeFor(...Array.from({ length: 15 }, () => [P, B, G, Y]));
    const text = formatAnnouncement(out, true);
    expect(text.length).toBeLessThanOrEqual(2000);
    for (let i = 1; i <= 15; i++) expect(text).toContain(`<@u${i}>`);
    expect(text).toMatch(/and \d+ more tied winners/);
    expect(text.startsWith('Current Winners (tie) for Connections #1000 with 17.75 points:')).toBe(true);
    expect(text).toContain('<@u1>: solved 4/4, 0 mistakes');
  });
});

describe('formatShareReply', () => {
  test('the sharer\'s puzzle, points, solved, mistakes and breakdown, with no lifetime stats', async () => {
    const out = await outcomeFor(NATURAL, [MISTAKE, ...NATURAL]);
    const text = formatShareReply(out, true);
    expect(text).toBe('<@u2> Puzzle #1000: 9 points, solved 4/4, 1 mistake\n• categories +10 (Y+1 G+2 B+3 P+4)\n• mistakes -1 (1 × -1)');
    expect(text).not.toContain('Lifetime');
  });

  test('uses the name when tagging is off', async () => {
    const out = await outcomeFor(NATURAL, [MISTAKE, ...NATURAL]);
    expect(formatShareReply(out, false).startsWith('u2 Puzzle #1000:')).toBe(true);
  });

  test('lists every scoring line, including rainbows, for a failed game', async () => {
    const out = await outcomeFor([RAINBOW, MISTAKE, MISTAKE, MISTAKE]);
    expect(formatShareReply(out, true)).toBe(
      '<@u1> Puzzle #1000: -3.5 points, solved 0/4, 4 mistakes\n• categories +0 (none solved)\n• mistakes -3 (3 × -1)\n• rainbows -0.5 (1 × -0.5)',
    );
  });

  test('shows the position and clean game bonuses when earned', async () => {
    const out = await outcomeFor([P, B, G, Y]);
    const text = formatShareReply(out, true);
    expect(text).toContain('• position bonus +3.75 (P solved 1st: 3 steps × 4 = 12; B solved 2nd: 1 step × 3 = 3; 15 units × 0.25)');
    expect(text).toContain('• clean game bonus +4 (no mistakes)');
  });

  test('works for an ignored player, who is never a winner', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    const out = await run(db, 'ign', [MISTAKE, ...NATURAL], { ignored: new Set(['ign']) });
    if (out.status !== 'saved') throw new Error();
    expect(formatShareReply(out, true).startsWith('<@ign> Puzzle #1000: 9 points')).toBe(true);
  });
});
