import { describe, expect, test } from 'bun:test';
import { handleMessage, type HandlerContext } from '../handler';
import { MISTAKE, NATURAL, fakeMessage, memoryDb, shareText } from './support';

async function ctx(over: Partial<HandlerContext> = {}): Promise<HandlerContext> {
  return { db: await memoryDb(), ignoredIds: new Set(), taggingEnabled: true, targetChannelId: 'chan', ...over };
}

describe('handleMessage', () => {
  test('ignores bots', async () => {
    const m = fakeMessage(shareText(NATURAL), { bot: true });
    await handleMessage(m, await ctx());
    expect(m.reactions).toEqual([]);
    expect(m.sent).toEqual([]);
  });

  test('ignores messages outside the target channel', async () => {
    const c = await ctx();
    const m = fakeMessage(shareText(NATURAL), { channelId: 'elsewhere' });
    await handleMessage(m, c);
    expect(m.reactions).toEqual([]);
    expect(await c.db.hasResult('u1', 1000)).toBe(false);
  });

  test('a valid share is stored, confirmed with ✅ and announced when the sharer is winning', async () => {
    const c = await ctx();
    const m = fakeMessage(shareText(NATURAL));
    await handleMessage(m, c);
    expect(m.reactions).toEqual(['✅']);
    expect(m.sent).toEqual(['Current Winner for Connections #1000 with 14 points (solved 4/4, 0 mistakes): <@u1>']);
    expect(await c.db.hasResult('u1', 1000)).toBe(true);
  });

  test('a valid share that is not winning gets ✅ but no announcement', async () => {
    const c = await ctx();
    await handleMessage(fakeMessage(shareText(NATURAL), { id: 'u1' }), c);
    const m = fakeMessage(shareText([MISTAKE, ...NATURAL]), { id: 'u2' });
    await handleMessage(m, c);
    expect(m.reactions).toEqual(['✅']);
    expect(m.sent).toEqual([]);
  });

  test('an impossible share gets ❌ only, and is not stored', async () => {
    const c = await ctx();
    const m = fakeMessage('Connections\nPuzzle #1000\n🟨🟨🟨🟨\n🟩🟩🟩🟩');
    await handleMessage(m, c);
    expect(m.reactions).toEqual(['❌']);
    expect(m.sent).toEqual([]);
    expect(await c.db.hasResult('u1', 1000)).toBe(false);
  });

  test('a duplicate share gets no reaction and no announcement', async () => {
    const c = await ctx();
    await handleMessage(fakeMessage(shareText(NATURAL)), c);
    const m = fakeMessage(shareText(NATURAL));
    await handleMessage(m, c);
    expect(m.reactions).toEqual([]);
    expect(m.sent).toEqual([]);
  });

  test('an ignored player\'s share is confirmed but never announced', async () => {
    const c = await ctx({ ignoredIds: new Set(['u1']) });
    const m = fakeMessage(shareText(NATURAL));
    await handleMessage(m, c);
    expect(m.reactions).toEqual(['✅']);
    expect(m.sent).toEqual([]);
  });

  test('announcements use names when tagging is off', async () => {
    const m = fakeMessage(shareText(NATURAL), { name: 'alice' });
    await handleMessage(m, await ctx({ taggingEnabled: false }));
    expect(m.sent[0]).toContain(': alice');
  });

  test('ordinary chatter is ignored', async () => {
    const m = fakeMessage('good morning');
    await handleMessage(m, await ctx());
    expect(m.reactions).toEqual([]);
    expect(m.sent).toEqual([]);
  });

  test('runs a command by name', async () => {
    const m = fakeMessage('!optin', { id: 'u9' });
    const c = await ctx();
    await handleMessage(m, c);
    expect(m.sent[0]).toMatch(/successfully opted in/);
    expect((await c.db.getPlayer('u9'))!.isOptedIn).toBe(true);
  });

  test('commands are case-insensitive', async () => {
    const m = fakeMessage('!OptIn');
    await handleMessage(m, await ctx());
    expect(m.sent[0]).toMatch(/opted in/);
  });

  test('an unknown command is named back; a malformed one is rejected', async () => {
    const a = fakeMessage('!bogus');
    await handleMessage(a, await ctx());
    expect(a.sent).toEqual(['Unknown command: bogus']);
    const b = fakeMessage('!bad-name');
    await handleMessage(b, await ctx());
    expect(b.sent).toEqual(['Invalid command.']);
  });

  test('a command that throws is reported without crashing', async () => {
    const c = await ctx();
    c.db.getPlayerEntries = async () => { throw new Error('db down'); };
    const m = fakeMessage('!results');
    await handleMessage(m, c);
    expect(m.sent).toEqual(['There was an error executing that command.']);
  });

  test('a failure while processing a share is contained and the share is not confirmed', async () => {
    const c = await ctx();
    c.db.saveResult = async () => { throw new Error('db down'); };
    const m = fakeMessage(shareText(NATURAL));
    await handleMessage(m, c);
    expect(m.reactions).toEqual([]);
  });
});
