import { describe, expect, test } from 'bun:test';
import { standingsCommand } from '../commands/standings';
import { handleMessage } from '../handler';
import { processShare } from '../processor';
import { MISTAKE, NATURAL, RAINBOW, B, G, P, Y, fakeMessage, makeShare, memoryDb } from './support';

type Db = Awaited<ReturnType<typeof memoryDb>>;
let minute = 0;
const post = (db: Db, id: string, name: string, rows: string[], puzzle = 1000) =>
  processShare(makeShare(rows, puzzle), { id, username: name }, new Date(Date.UTC(2026, 0, 1, 0, ++minute)), db, new Set());

async function run(db: Db, args: string[], ignoredIds = new Set<string>()) {
  const m = fakeMessage(`!standings ${args.join(' ')}`.trim());
  await standingsCommand.execute(m, args, { db, ignoredIds });
  return m.sent;
}

async function fourPlayers() {
  const db = await memoryDb();
  await post(db, 'a', 'alice', NATURAL); // 45
  await post(db, 'b', 'bob', [MISTAKE, P, B, G, Y]); // 38.5
  await post(db, 'c', 'cara', [RAINBOW, ...NATURAL]); // 30.25
  await post(db, 'd', 'dan', [MISTAKE, MISTAKE, MISTAKE, MISTAKE]); // -40
  return db;
}

describe('!standings', () => {
  test('is registered as a command', () => {
    expect(standingsCommand.name).toBe('standings');
    expect(standingsCommand.description.length).toBeGreaterThan(10);
  });

  test('lists every player best first with score, groups solved, mistakes and solve order', async () => {
    const [text] = await run(await fourPlayers(), ['1000']);
    expect(text).toBe(
      [
        '**Connections #1000 results** (4 players)',
        '1. 🏆 alice — 45 points (solved 4/4, 0 mistakes) 🟨🟩🟦🟪',
        '2. bob — 38.5 points (solved 4/4, 1 mistake) 🟪🟦🟩🟨',
        '3. cara — 30.25 points (solved 4/4, 1 mistake) 🟨🟩🟦🟪 🌈',
        '4. dan — -40 points (solved 0/4, 4 mistakes)',
      ].join('\n'),
    );
  });

  test('defaults to the most recent puzzle that has results', async () => {
    const db = await memoryDb();
    await post(db, 'a', 'alice', NATURAL, 998);
    await post(db, 'a', 'alice', NATURAL, 1001);
    await post(db, 'b', 'bob', NATURAL, 999);
    const [text] = await run(db, []);
    expect(text).toContain('**Connections #1001 results** (1 player)');
  });

  test('a puzzle number picks that puzzle', async () => {
    const db = await memoryDb();
    await post(db, 'a', 'alice', NATURAL, 999);
    await post(db, 'a', 'alice', NATURAL, 1000);
    const [text] = await run(db, ['999']);
    expect(text).toContain('**Connections #999 results**');
  });

  test('players with equal scores share a rank and both get the trophy; the next rank skips', async () => {
    const db = await memoryDb();
    await post(db, 'a', 'alice', NATURAL);
    await post(db, 'b', 'bob', NATURAL);
    await post(db, 'c', 'cara', [MISTAKE, ...NATURAL]);
    const [text] = await run(db, ['1000']);
    const lines = text!.split('\n');
    expect(lines[1]).toMatch(/^1\. 🏆 alice/);
    expect(lines[2]).toMatch(/^1\. 🏆 bob/);
    expect(lines[3]).toMatch(/^3\. cara/);
  });

  test('ranks with the live scoring from the raw results, not from stored scores', async () => {
    const db = await memoryDb();
    for (const [id, name, rows, stale] of [['a', 'alice', NATURAL, -999], ['b', 'bob', [MISTAKE, ...NATURAL], 999]] as const) {
      const s = makeShare([...rows], 1000);
      await db.upsertPlayer(id, name);
      await db.saveResult({ discordId: id, puzzleNumber: 1000, guessRows: s.guesses.map((g) => g.colors.join('')), solvedOrder: s.solvedOrder, mistakes: s.mistakes, rainbows: s.rainbows, failed: s.failed, postedAt: '2026-01-01T00:00:00.000Z' }, stale);
    }
    const [text] = await run(db, ['1000']);
    expect(text).toContain('1. 🏆 alice — 45 points');
    expect(text).toContain('2. bob — 30 points');
  });

  test('includes opted-out players: these are results already posted in the channel', async () => {
    const db = await fourPlayers();
    expect((await db.getPlayer('a'))!.isOptedIn).toBe(false);
    const [text] = await run(db, ['1000']);
    expect(text).toContain('alice');
  });

  test('leaves out ignored players, who never compete, and does not count them', async () => {
    const db = await fourPlayers();
    const [text] = await run(db, ['1000'], new Set(['a']));
    expect(text).not.toContain('alice');
    expect(text).toContain('(3 players)');
    expect(text).toContain('1. 🏆 bob');
  });

  test('never tags anyone', async () => {
    const [text] = await run(await fourPlayers(), ['1000']);
    expect(text).not.toContain('<@');
  });

  test('escapes markdown in names so they cannot break the formatting', async () => {
    const db = await memoryDb();
    await post(db, 'a', 'a_b*c~d`e', NATURAL);
    const [text] = await run(db, ['1000']);
    expect(text).toContain('a\\_b\\*c\\~d\\`e');
  });

  test('a long list is split across messages, none over 2000 characters, nobody lost', async () => {
    const db = await memoryDb();
    for (let i = 0; i < 60; i++) await post(db, `u${i}`, `player-number-${i}`, [P, B, G, Y]);
    const sent = await run(db, ['1000']);
    expect(sent.length).toBeGreaterThan(1);
    for (const text of sent) expect(text.length).toBeLessThanOrEqual(2000);
    const joined = sent.join('\n');
    for (let i = 0; i < 60; i++) expect(joined).toContain(`player-number-${i} `);
    expect(sent[0]).toContain('(60 players)');
    expect(sent[1]).not.toContain('**Connections');
  });

  test('says so when the puzzle has no results', async () => {
    const db = await fourPlayers();
    expect(await run(db, ['5'])).toEqual(['No results found for puzzle #5.']);
  });

  test('says so when nothing has been shared yet', async () => {
    expect(await run(await memoryDb(), [])).toEqual(['No Connections results yet.']);
  });

  test('a puzzle number that is not a number gets the usage line', async () => {
    expect(await run(await memoryDb(), ['abc'])).toEqual(['Usage: !standings [puzzle number]']);
  });

  test('works through the message handler, passing along the ignore list', async () => {
    const db = await fourPlayers();
    const m = fakeMessage('!standings 1000');
    await handleMessage(m, { db, ignoredIds: new Set(['d']), taggingEnabled: true, targetChannelId: 'chan' });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toContain('(3 players)');
    expect(m.sent[0]).not.toContain('dan');
  });
});
