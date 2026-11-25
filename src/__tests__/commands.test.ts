import { describe, expect, test } from 'bun:test';
import { optInCommand, optOutCommand } from '../commands/opt';
import { resultsCommand } from '../commands/results';
import { processShare } from '../processor';
import { MISTAKE, NATURAL, B, G, P, Y, fakeMessage, makeShare, memoryDb } from './support';

const run = (db: Awaited<ReturnType<typeof memoryDb>>, id: string, rows: string[], puzzle = 1000) =>
  processShare(makeShare(rows, puzzle), { id, username: id }, new Date('2026-01-01T00:00:00Z'), db, new Set());

describe('!optin and !optout', () => {
  test('opting in works for a player who has not shared yet, and says so', async () => {
    const db = await memoryDb();
    const m = fakeMessage('!optin', { id: 'u1', name: 'alice' });
    await optInCommand.execute(m, [], { db });
    expect(m.sent[0]).toContain('<@u1>');
    expect(m.sent[0]).toMatch(/successfully opted in/);
    expect((await db.getPlayer('u1'))!.isOptedIn).toBe(true);
  });

  test('opting in twice says they already had', async () => {
    const db = await memoryDb();
    await optInCommand.execute(fakeMessage('!optin', { id: 'u1' }), [], { db });
    const m = fakeMessage('!optin', { id: 'u1' });
    await optInCommand.execute(m, [], { db });
    expect(m.sent[0]).toMatch(/already opted in/);
  });

  test('opting out reverses it, and repeating says they already had', async () => {
    const db = await memoryDb();
    await optInCommand.execute(fakeMessage('!optin', { id: 'u1' }), [], { db });
    const m = fakeMessage('!optout', { id: 'u1' });
    await optOutCommand.execute(m, [], { db });
    expect(m.sent[0]).toMatch(/successfully opted out/);
    expect((await db.getPlayer('u1'))!.isOptedIn).toBe(false);
    const again = fakeMessage('!optout', { id: 'u1' });
    await optOutCommand.execute(again, [], { db });
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
    await resultsCommand.execute(m, [], { db });
    expect(m.sent).toEqual(['<@u1> no Connections results found yet.']);
  });

  test('defaults to the latest puzzle and adds lifetime totals', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL, 999); // 45, wins
    await run(db, 'u1', [MISTAKE, ...NATURAL], 1000); // 30, wins (alone)
    const m = fakeMessage('!results', { id: 'u1' });
    await resultsCommand.execute(m, [], { db });
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
    await resultsCommand.execute(m, ['999'], { db });
    expect(m.sent[0]).toContain('Puzzle #999');
    expect(m.sent[0]).toContain('45 points');
    expect(m.sent[0]).toMatch(/tied for the win/);
  });

  test('says when it was not a win', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    await run(db, 'u2', [P, B, G, Y]);
    const m = fakeMessage('!results', { id: 'u1' });
    await resultsCommand.execute(m, [], { db });
    expect(m.sent[0]).not.toMatch(/won|tied/);
  });

  test('an unknown puzzle number', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    const m = fakeMessage('!results 5', { id: 'u1' });
    await resultsCommand.execute(m, ['5'], { db });
    expect(m.sent[0]).toBe('<@u1> no result found for puzzle #5.');
  });

  test('a puzzle number that is not a number', async () => {
    const m = fakeMessage('!results abc', { id: 'u1' });
    await resultsCommand.execute(m, ['abc'], { db: await memoryDb() });
    expect(m.sent[0]).toContain('Usage');
  });

  test('a player who is opted out still sees their own results', async () => {
    const db = await memoryDb();
    await run(db, 'u1', NATURAL);
    expect((await db.getPlayer('u1'))!.isOptedIn).toBe(false);
    const m = fakeMessage('!results', { id: 'u1' });
    await resultsCommand.execute(m, [], { db });
    expect(m.sent[0]).toContain('45 points');
  });
});

describe('the command list', () => {
  test('includes !scoring', async () => {
    const { COMMANDS } = await import('../commands');
    expect(COMMANDS.has('scoring')).toBe(true);
    expect([...COMMANDS.keys()].sort()).toEqual(['optin', 'optout', 'results', 'scoring']);
  });
});
