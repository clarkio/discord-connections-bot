import { describe, expect, test } from 'bun:test';
import { optInCommand, optOutCommand } from '../commands/opt';
import { resultsCommand } from '../commands/results';
import { handleMessage } from '../handler';
import { processShare } from '../processor';
import { MISTAKE, NATURAL, B, G, P, Y, fakeMessage, makeShare, memoryDb } from './support';

const run = (db: Awaited<ReturnType<typeof memoryDb>>, id: string, rows: string[], puzzle = 1000) =>
  processShare(makeShare(rows, puzzle), { id, username: id }, new Date('2026-01-01T00:00:00Z'), db, new Set());

describe('!optin and !optout', () => {
  test('opting in works for a player who has not shared yet, and says so', async () => {
    const db = await memoryDb();
    const m = fakeMessage('!optin', { id: 'u1', name: 'alice' });
    await optInCommand.execute(m, [], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toContain('<@u1>');
    expect(m.sent[0]).toMatch(/successfully opted in/);
    expect((await db.getPlayer('u1'))!.isOptedIn).toBe(true);
  });

  test('opting in twice says they already had', async () => {
    const db = await memoryDb();
    await optInCommand.execute(fakeMessage('!optin', { id: 'u1' }), [], { db, ignoredIds: new Set() });
    const m = fakeMessage('!optin', { id: 'u1' });
    await optInCommand.execute(m, [], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toMatch(/already opted in/);
  });

  test('opting out reverses it, and repeating says they already had', async () => {
    const db = await memoryDb();
    await optInCommand.execute(fakeMessage('!optin', { id: 'u1' }), [], { db, ignoredIds: new Set() });
    const m = fakeMessage('!optout', { id: 'u1' });
    await optOutCommand.execute(m, [], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toMatch(/successfully opted out/);
    expect((await db.getPlayer('u1'))!.isOptedIn).toBe(false);
    const again = fakeMessage('!optout', { id: 'u1' });
    await optOutCommand.execute(again, [], { db, ignoredIds: new Set() });
    expect(again.sent[0]).toMatch(/already opted out/);
  });

  test('command names match what players type', () => {
    expect(optInCommand.name).toBe('optin');
    expect(optOutCommand.name).toBe('optout');
    expect(resultsCommand.name).toBe('results');
  });
});

describe('!results', () => {
  test('with no history', async () => {
    const db = await memoryDb();
    const m = fakeMessage('!results', { id: 'u1' });
    await resultsCommand.execute(m, [], { db, ignoredIds: new Set() });
    expect(m.sent).toEqual(['<@u1> no Connections results found yet.']);
  });

  test('defaults to the latest puzzle and adds lifetime totals', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL, 999); // 45, wins
    await run(db, 'u1', [MISTAKE, ...NATURAL], 1000); // 30, wins (alone)
    const m = fakeMessage('!results', { id: 'u1' });
    await resultsCommand.execute(m, [], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toContain('Puzzle #1000');
    expect(m.sent[0]).toContain('30 points');
    expect(m.sent[0]).toContain('solved 4/4');
    expect(m.sent[0]).toContain('1 mistake');
    expect(m.sent[0]).toContain('Lifetime: 2 puzzles, 75 points (37.5 average), 2 wins, 0 ties');
  });

  test('a puzzle number picks that puzzle and shows how it ended', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL, 999);
    await run(db, 'u2', NATURAL, 999);
    const m = fakeMessage('!results 999', { id: 'u1' });
    await resultsCommand.execute(m, ['999'], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toContain('Puzzle #999');
    expect(m.sent[0]).toContain('45 points');
    expect(m.sent[0]).toMatch(/tied for the win/);
  });

  test('says when it was not a win', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    await run(db, 'u2', [P, B, G, Y]);
    const m = fakeMessage('!results', { id: 'u1' });
    await resultsCommand.execute(m, [], { db, ignoredIds: new Set() });
    expect(m.sent[0]).not.toMatch(/won|tied/);
  });

  test('an unknown puzzle number', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    const m = fakeMessage('!results 5', { id: 'u1' });
    await resultsCommand.execute(m, ['5'], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toBe('<@u1> no result found for puzzle #5.');
  });

  test('a puzzle number that is not a number', async () => {
    const m = fakeMessage('!results abc', { id: 'u1' });
    await resultsCommand.execute(m, ['abc'], { db: await memoryDb(), ignoredIds: new Set() });
    expect(m.sent[0]).toContain('Usage');
  });

  test('a player who is opted out still sees their own results', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    expect((await db.getPlayer('u1'))!.isOptedIn).toBe(false);
    const m = fakeMessage('!results', { id: 'u1' });
    await resultsCommand.execute(m, [], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toContain('45 points');
  });
});

describe('!results first', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
  const post = (db: Awaited<ReturnType<typeof memoryDb>>, id: string, rows: string[], puzzle: number, minute: number) =>
    processShare(makeShare(rows, puzzle), { id, username: id }, at(minute), db, new Set());

  test('returns the result for the player\'s first puzzle, with lifetime totals', async () => {
    const db = await memoryDb();
    await post(db, 'u1', [MISTAKE, ...NATURAL], 998, 1); // 30, wins (alone)
    await post(db, 'u1', NATURAL, 999, 2); // 45
    await post(db, 'u1', NATURAL, 1000, 3); // 45
    const m = fakeMessage('!results first', { id: 'u1' });
    await resultsCommand.execute(m, ['first'], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toContain('<@u1> Puzzle #998: 30 points, solved 4/4, 1 mistake, you won this puzzle');
    expect(m.sent[0]).toContain('Lifetime: 3 puzzles, 120 points (40 average), 3 wins, 0 ties');
  });

  test('first means the lowest puzzle number, even if that puzzle was shared later', async () => {
    const db = await memoryDb();
    await post(db, 'u1', NATURAL, 1000, 1);
    await post(db, 'u1', [MISTAKE, ...NATURAL], 990, 2); // an older puzzle, shared afterwards
    const m = fakeMessage('!results first', { id: 'u1' });
    await resultsCommand.execute(m, ['first'], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toContain('Puzzle #990:');
  });

  test('is not case sensitive', async () => {
    const db = await memoryDb();
    await post(db, 'u1', NATURAL, 1000, 1);
    for (const word of ['First', 'FIRST', 'fIrSt']) {
      const m = fakeMessage(`!results ${word}`, { id: 'u1' });
      await resultsCommand.execute(m, [word], { db, ignoredIds: new Set() });
      expect(m.sent[0]).toContain('Puzzle #1000:');
    }
  });

  test('with a single result, that is the first', async () => {
    const db = await memoryDb();
    await post(db, 'u1', NATURAL, 1000, 1);
    const m = fakeMessage('!results first', { id: 'u1' });
    await resultsCommand.execute(m, ['first'], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toContain('Puzzle #1000: 45 points');
    expect(m.sent[0]).toContain('Lifetime: 1 puzzle,');
  });

  test('only looks at the player\'s own results', async () => {
    const db = await memoryDb();
    await post(db, 'u2', NATURAL, 900, 1); // someone else, earlier puzzle
    await post(db, 'u1', NATURAL, 1000, 2);
    const m = fakeMessage('!results first', { id: 'u1' });
    await resultsCommand.execute(m, ['first'], { db, ignoredIds: new Set() });
    expect(m.sent[0]).toContain('Puzzle #1000:');
  });

  test('says so when the player has no results yet', async () => {
    const m = fakeMessage('!results first', { id: 'u1' });
    await resultsCommand.execute(m, ['first'], { db: await memoryDb(), ignoredIds: new Set() });
    expect(m.sent).toEqual(['<@u1> no Connections results found yet.']);
  });

  test('the usage line now mentions it', async () => {
    const m = fakeMessage('!results nope', { id: 'u1' });
    await resultsCommand.execute(m, ['nope'], { db: await memoryDb(), ignoredIds: new Set() });
    expect(m.sent[0]).toContain('Usage: !results [puzzle number | first]');
  });

  test('works through the message handler', async () => {
    const db = await memoryDb();
    await post(db, 'u1', [MISTAKE, ...NATURAL], 998, 1);
    await post(db, 'u1', NATURAL, 1000, 2);
    const m = fakeMessage('!results first', { id: 'u1' });
    await handleMessage(m, { db, ignoredIds: new Set(), taggingEnabled: true, targetChannelId: 'chan' });
    expect(m.sent[0]).toContain('Puzzle #998:');
  });
});

describe('the command list', () => {
  test('includes !scoring', async () => {
    const { COMMANDS } = await import('../commands');
    expect(COMMANDS.has('scoring')).toBe(true);
    expect([...COMMANDS.keys()].sort()).toEqual(['optin', 'optout', 'results', 'scoring', 'standings']);
  });
});
