import { describe, expect, test } from 'bun:test';
import { backfillHistory, formatInvalidShares, type BackfillMessage } from '../backfill';
import { processShare } from '../processor';
import { MISTAKE, NATURAL, B, G, P, Y, makeShare, memoryDb, shareText } from './support';

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
const msg = (id: string, rows: string[], puzzle: number, minutes: number, over: Partial<BackfillMessage> = {}): BackfillMessage => ({
  authorId: id,
  authorName: `name-${id}`,
  authorIsBot: false,
  content: shareText(rows, puzzle),
  createdAt: at(minutes),
  ...over,
});
const none = new Set<string>();

const flags = async (db: Awaited<ReturnType<typeof memoryDb>>, puzzle: number) =>
  Object.fromEntries((await db.getPuzzleEntries(puzzle)).map((e) => [e.discordId, [e.dailyScore, e.isWin, e.isTie]]));

describe('backfillHistory', () => {
  test('imports shares with real ids and names, scored like the live bot, with wins and ties set per puzzle', async () => {
    const db = await memoryDb();
    const summary = await backfillHistory(
      [
        msg('u1', NATURAL, 1000, 1), msg('u2', [MISTAKE, ...NATURAL], 1000, 2),
        msg('u1', NATURAL, 1001, 3), msg('u2', NATURAL, 1001, 4),
      ],
      db, none, { apply: true },
    );
    expect(summary).toMatchObject({ applied: true, inserted: 4, puzzles: 2, players: 2, duplicates: 0, alreadyStored: 0 });
    expect(await flags(db, 1000)).toEqual({ u1: [45, true, false], u2: [30, false, false] });
    expect(await flags(db, 1001)).toEqual({ u1: [45, false, true], u2: [45, false, true] });
    expect((await db.getPlayer('u1'))!.discordName).toBe('name-u1');
  });

  test('stores the original posting time and the raw result', async () => {
    const db = await memoryDb();
    await backfillHistory([msg('u1', [MISTAKE, ...NATURAL], 1000, 7)], db, none, { apply: true });
    const [e] = await db.getPuzzleEntries(1000);
    expect(e!.result.postedAt).toBe(at(7).toISOString());
    expect(e!.result).toMatchObject({ mistakes: 1, solvedOrder: ['Y', 'G', 'B', 'P'], failed: false });
  });

  test('the earliest share per player and puzzle counts, whatever order the messages arrive in', async () => {
    const db = await memoryDb();
    // Discord returns newest first: the later share comes first in the list.
    const summary = await backfillHistory(
      [msg('u1', [MISTAKE, ...NATURAL], 1000, 9), msg('u1', NATURAL, 1000, 1)],
      db, none, { apply: true },
    );
    expect(summary).toMatchObject({ inserted: 1, duplicates: 1 });
    expect((await flags(db, 1000)).u1![0]).toBe(45);
  });

  test('imports a share that was hidden in a spoiler', async () => {
    const db = await memoryDb();
    const spoilered = { ...msg('u1', NATURAL, 1000, 1), content: `I lost today\n||${shareText(NATURAL, 1000)}||` };
    const summary = await backfillHistory([spoilered], db, none, { apply: true });
    expect(summary).toMatchObject({ inserted: 1, notShares: 0 });
    expect(await flags(db, 1000)).toEqual({ u1: [45, true, false] });
  });

  test('skips bots, chatter and impossible shares, and counts them', async () => {
    const db = await memoryDb();
    const summary = await backfillHistory(
      [
        msg('u1', NATURAL, 1000, 1),
        msg('bot', NATURAL, 1000, 2, { authorIsBot: true }),
        { ...msg('u2', NATURAL, 1000, 3), content: 'good morning' },
        { ...msg('u3', NATURAL, 1000, 4), content: 'Connections\nPuzzle #1000\n🟨🟨🟨🟨' },
      ],
      db, none, { apply: true },
    );
    expect(summary).toMatchObject({ messagesRead: 4, inserted: 1, bots: 1, notShares: 1, invalid: 1 });
    expect(await db.getPuzzleEntries(1000)).toHaveLength(1);
  });

  test('ignored players are stored but never win or tie', async () => {
    const db = await memoryDb();
    await backfillHistory([msg('u1', [MISTAKE, ...NATURAL], 1000, 1), msg('ign', [P, B, G, Y], 1000, 2)], db, new Set(['ign']), { apply: true });
    expect(await flags(db, 1000)).toEqual({ u1: [30, true, false], ign: [53.5, false, false] });
  });

  test('running it twice stores nothing new the second time', async () => {
    const db = await memoryDb();
    const messages = [msg('u1', NATURAL, 1000, 1), msg('u2', NATURAL, 1000, 2)];
    await backfillHistory(messages, db, none, { apply: true });
    const again = await backfillHistory(messages, db, none, { apply: true });
    expect(again).toMatchObject({ inserted: 0, alreadyStored: 2 });
    expect(await flags(db, 1000)).toEqual({ u1: [45, false, true], u2: [45, false, true] });
  });

  test('never overwrites a result the live bot already stored, and counts it with the new ones', async () => {
    const db = await memoryDb();
    await processShare(makeShare([MISTAKE, ...NATURAL], 1000), { id: 'u1', username: 'live-name' }, at(500), db, none);
    const summary = await backfillHistory([msg('u1', NATURAL, 1000, 1), msg('u2', [MISTAKE, ...NATURAL], 1000, 2)], db, none, { apply: true });
    expect(summary).toMatchObject({ inserted: 1, alreadyStored: 1 });
    expect(await flags(db, 1000)).toEqual({ u1: [30, false, true], u2: [30, false, true] });
  });

  test('leaves a player\'s opt-in alone', async () => {
    const db = await memoryDb();
    await db.upsertPlayer('u1', 'alice');
    await db.setOptedIn('u1', true);
    await backfillHistory([msg('u1', NATURAL, 1000, 1)], db, none, { apply: true });
    expect((await db.getPlayer('u1'))!.isOptedIn).toBe(true);
  });

  test('a dry run reports what it would do and writes nothing', async () => {
    const db = await memoryDb();
    await processShare(makeShare(NATURAL, 1000), { id: 'u1', username: 'a' }, at(0), db, none);
    const summary = await backfillHistory(
      [msg('u1', NATURAL, 1000, 1), msg('u2', NATURAL, 1000, 2), msg('u3', NATURAL, 1001, 3)],
      db, none, { apply: false },
    );
    expect(summary).toMatchObject({ applied: false, inserted: 2, alreadyStored: 1, puzzles: 2, players: 3 });
    expect(await db.getPuzzleEntries(1001)).toEqual([]);
    expect(await db.getPlayer('u2')).toBeUndefined();
    expect(await flags(db, 1000)).toEqual({ u1: [45, true, false] }); // untouched
  });

  test('reports progress through a callback, one call per puzzle', async () => {
    const db = await memoryDb();
    const seen: number[] = [];
    await backfillHistory([msg('u1', NATURAL, 1000, 1), msg('u1', NATURAL, 1001, 2)], db, none, { apply: true, onPuzzle: (n) => seen.push(n) });
    expect(seen).toEqual([1000, 1001]);
  });
});

describe('impossible shares in the backfill', () => {
  const UNFINISHED = 'Connections\nPuzzle #1000\n🟨🟨🟨🟨\n🟩🟩🟩🟩';
  const bad = (over: Partial<BackfillMessage> = {}): BackfillMessage => ({
    ...msg('u3', NATURAL, 1000, 4),
    authorName: 'bad-author',
    content: UNFINISHED,
    url: 'https://discord.com/channels/1/2/3',
    ...over,
  });

  test('lists each one with why, who, when, a link and the text, matching the count', async () => {
    const db = await memoryDb();
    const summary = await backfillHistory([msg('u1', NATURAL, 1000, 1), bad()], db, none, { apply: true });
    expect(summary.invalid).toBe(1);
    expect(summary.invalidShares).toEqual([
      {
        reason: 'the puzzle looks unfinished: fewer than four groups solved and fewer than four mistakes made',
        authorName: 'bad-author',
        postedAt: at(4).toISOString(),
        url: 'https://discord.com/channels/1/2/3',
        content: UNFINISHED,
      },
    ]);
  });

  test('also listed in a dry run, and when the share was hidden in a spoiler', async () => {
    const db = await memoryDb();
    const spoilered = bad({ content: `||${UNFINISHED}||` });
    const summary = await backfillHistory([spoilered], db, none, { apply: false });
    expect(summary.invalidShares).toHaveLength(1);
    expect(summary.invalidShares[0]!.reason).toContain('unfinished');
  });

  test('a message with no link is still listed', async () => {
    const summary = await backfillHistory([bad({ url: undefined })], await memoryDb(), none, { apply: false });
    expect(summary.invalidShares[0]!.url).toBeUndefined();
  });

  test('valid shares, chatter and bots are never listed', async () => {
    const summary = await backfillHistory(
      [msg('u1', NATURAL, 1000, 1), { ...msg('u2', NATURAL, 1000, 2), content: 'hello' }, msg('bot', NATURAL, 1000, 3, { authorIsBot: true })],
      await memoryDb(), none, { apply: false },
    );
    expect(summary.invalidShares).toEqual([]);
  });

  test('formatInvalidShares shows the reason, who, when, the link and the share text', async () => {
    const summary = await backfillHistory([bad()], await memoryDb(), none, { apply: false });
    const text = formatInvalidShares(summary.invalidShares);
    expect(text).toContain('Impossible shares (1)');
    expect(text).toContain('bad-author');
    expect(text).toContain('2026-01-01 00:04 UTC');
    expect(text).toContain('Why: the puzzle looks unfinished');
    expect(text).toContain('https://discord.com/channels/1/2/3');
    expect(text).toContain('| 🟨🟨🟨🟨');
  });

  test('formatInvalidShares says nothing when there are none', () => {
    expect(formatInvalidShares([])).toBe('');
  });

  test('formatInvalidShares caps a long list and says how many were left out', async () => {
    const many = Array.from({ length: 25 }, (_, i) => bad({ authorId: `x${i}`, authorName: `author-${i}` }));
    const summary = await backfillHistory(many, await memoryDb(), none, { apply: false });
    const text = formatInvalidShares(summary.invalidShares, 10);
    expect(text).toContain('Impossible shares (25)');
    expect(text).toContain('author-9');
    expect(text).not.toContain('author-10');
    expect(text).toContain('and 15 more');
  });

  test('formatInvalidShares trims a very long message', async () => {
    const long = bad({ content: `${UNFINISHED}\n${'blah '.repeat(200)}` });
    const summary = await backfillHistory([long], await memoryDb(), none, { apply: false });
    expect(formatInvalidShares(summary.invalidShares).length).toBeLessThan(900);
  });
});

describe('text around a share in the backfill', () => {
  const SCREENSHOT = ['🟦🟪🟨🟩', '🟨🟨🟨🟨', '🟩🟦🟩🟩', '🟪🟪🟦🟪', '🟦🟩🟩🟩🌈'];

  test('a share with an emoji after a row is imported, not reported as impossible', async () => {
    const db = await memoryDb();
    const m = { ...msg('u1', NATURAL, 1089, 1), content: `I lost today\n${shareText(SCREENSHOT, 1089)}` };
    const summary = await backfillHistory([m], db, none, { apply: true });
    expect(summary).toMatchObject({ inserted: 1, invalid: 0, invalidShares: [] });
    expect(await flags(db, 1089)).toEqual({ u1: [-29.75, true, false] });
  });

  test('a share interrupted by text is reported with that reason', async () => {
    const m = { ...msg('u1', NATURAL, 1089, 1), content: shareText(['🟨🟨🟨🟨', 'oops', '🟩🟩🟩🟩', '🟦🟦🟦🟦', '🟪🟪🟪🟪'], 1089) };
    const summary = await backfillHistory([m], await memoryDb(), none, { apply: false });
    expect(summary.invalidShares[0]!.reason).toBe('the rows of squares are interrupted by other text');
  });
});
