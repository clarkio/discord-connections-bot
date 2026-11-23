import { describe, expect, test } from 'bun:test';
import { handleMessage, isTaggingEnabled, type HandlerContext } from '../handler';
import { MISTAKE, NATURAL, RAINBOW, fakeMessage, memoryDb, shareText } from './support';

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
    expect(m.sent).toEqual(['Current Winner for Connections #1000 with 14 points (solved 4/4, 0 mistakes): <@u1>\n• categories +10 (Y+1 G+2 B+3 P+4)\n• clean game bonus +4 (no mistakes)']);
    expect(await c.db.hasResult('u1', 1000)).toBe(true);
  });

  test('a share that is not winning gets ✅ and a personal reply with its score breakdown', async () => {
    const c = await ctx();
    await handleMessage(fakeMessage(shareText(NATURAL), { id: 'u1' }), c);
    const m = fakeMessage(shareText([MISTAKE, ...NATURAL]), { id: 'u2' });
    await handleMessage(m, c);
    expect(m.reactions).toEqual(['✅']);
    expect(m.sent).toEqual([
      '<@u2> Puzzle #1000: 9 points, solved 4/4, 1 mistake\n• categories +10 (Y+1 G+2 B+3 P+4)\n• mistakes -1 (1 × -1)',
    ]);
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

  test('an ignored player\'s share is confirmed and gets a personal reply, but is never announced as a winner', async () => {
    const c = await ctx({ ignoredIds: new Set(['u1']) });
    const m = fakeMessage(shareText(NATURAL));
    await handleMessage(m, c);
    expect(m.reactions).toEqual(['✅']);
    expect(m.sent).toEqual(['<@u1> Puzzle #1000: 14 points, solved 4/4, 0 mistakes\n• categories +10 (Y+1 G+2 B+3 P+4)\n• clean game bonus +4 (no mistakes)']);
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

const Y_ROW = '🟨🟨🟨🟨';

describe('rainbow reaction', () => {
  test('a counted share with a rainbow guess gets 🌈 as well as ✅', async () => {
    const m = fakeMessage(shareText([RAINBOW, ...NATURAL]));
    await handleMessage(m, await ctx());
    expect(m.reactions).toEqual(['✅', '🌈']);
  });

  test('a share without a rainbow guess gets only ✅', async () => {
    const m = fakeMessage(shareText([MISTAKE, ...NATURAL]));
    await handleMessage(m, await ctx());
    expect(m.reactions).toEqual(['✅']);
  });

  test('several rainbow guesses still give a single 🌈', async () => {
    const m = fakeMessage(shareText([RAINBOW, RAINBOW, ...NATURAL]));
    await handleMessage(m, await ctx());
    expect(m.reactions).toEqual(['✅', '🌈']);
  });

  test('a rainbow guess in a failed game counts too', async () => {
    const m = fakeMessage(shareText([RAINBOW, MISTAKE, MISTAKE, MISTAKE]));
    await handleMessage(m, await ctx());
    expect(m.reactions).toEqual(['✅', '🌈']);
  });

  test('a duplicate share gets no reaction at all', async () => {
    const c = await ctx();
    await handleMessage(fakeMessage(shareText([RAINBOW, ...NATURAL])), c);
    const again = fakeMessage(shareText([RAINBOW, ...NATURAL]));
    await handleMessage(again, c);
    expect(again.reactions).toEqual([]);
  });

  test('an impossible share gets ❌ only, even if it contains a rainbow row', async () => {
    const m = fakeMessage(shareText([RAINBOW, Y_ROW]));
    await handleMessage(m, await ctx());
    expect(m.reactions).toEqual(['❌']);
  });

  test('an ignored player still gets 🌈', async () => {
    const m = fakeMessage(shareText([RAINBOW, ...NATURAL]));
    await handleMessage(m, await ctx({ ignoredIds: new Set(['u1']) }));
    expect(m.reactions).toEqual(['✅', '🌈']);
  });

  test('a rainbow winner is still announced', async () => {
    const m = fakeMessage(shareText([RAINBOW, ...NATURAL]));
    await handleMessage(m, await ctx());
    expect(m.sent).toEqual([
      'Current Winner for Connections #1000 with 9.5 points (solved 4/4, 1 mistake): <@u1>\n• categories +10 (Y+1 G+2 B+3 P+4)\n• rainbows -0.5 (1 × -0.5)',
    ]);
  });

  test('if the 🌈 reaction fails, ✅ and the announcement are unaffected', async () => {
    const m = fakeMessage(shareText([RAINBOW, ...NATURAL]));
    const original = m.react.bind(m);
    m.react = async (emoji) => {
      if (emoji === '🌈') throw new Error('Missing Permissions');
      await original(emoji);
    };
    await handleMessage(m, await ctx());
    expect(m.reactions).toEqual(['✅']);
    expect(m.sent).toHaveLength(1);
  });
});

describe('isTaggingEnabled: reading USER_TAGGING_ENABLED', () => {
  test.each(['true', 'TRUE', 'True', 'tRuE', ' true ', 'TRUE\n'])('%j turns tagging on', (value) => {
    expect(isTaggingEnabled(value)).toBe(true);
  });

  test.each([undefined, '', 'false', 'FALSE', 'yes', '1', 'on', 'truee', 'not true'])('%j leaves tagging off', (value) => {
    expect(isTaggingEnabled(value)).toBe(false);
  });
});

describe('one message per counted share', () => {
  test('a winner gets the announcement with details and no second reply', async () => {
    const m = fakeMessage(shareText(NATURAL));
    await handleMessage(m, await ctx());
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatch(/^Current Winner for Connections #1000/);
  });

  test('a tied sharer gets the tie announcement with each winner\'s details', async () => {
    const c = await ctx();
    await handleMessage(fakeMessage(shareText(NATURAL), { id: 'u1' }), c);
    const m = fakeMessage(shareText(NATURAL), { id: 'u2' });
    await handleMessage(m, c);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toContain('Current Winners (tie)');
    expect(m.sent[0]).toContain('<@u1>: solved 4/4, 0 mistakes');
    expect(m.sent[0]).toContain('<@u2>: solved 4/4, 0 mistakes');
  });

  test('the reply names the player when tagging is off', async () => {
    const c = await ctx({ taggingEnabled: false });
    await handleMessage(fakeMessage(shareText(NATURAL), { id: 'u1' }), c);
    const m = fakeMessage(shareText([MISTAKE, ...NATURAL]), { id: 'u2', name: 'bob' });
    await handleMessage(m, c);
    expect(m.sent[0]).toMatch(/^bob Puzzle #1000: 9 points/);
  });

  test('a duplicate share gets no reply', async () => {
    const c = await ctx();
    await handleMessage(fakeMessage(shareText(NATURAL)), c);
    const again = fakeMessage(shareText(NATURAL));
    await handleMessage(again, c);
    expect(again.sent).toEqual([]);
  });

  test('an impossible share gets no reply', async () => {
    const m = fakeMessage('Connections\nPuzzle #1000\n🟨🟨🟨🟨');
    await handleMessage(m, await ctx());
    expect(m.sent).toEqual([]);
  });

  test('if sending the message fails, the share is still stored and confirmed', async () => {
    const c = await ctx();
    const m = fakeMessage(shareText(NATURAL));
    m.channel.send = async () => { throw new Error('Missing Permissions'); };
    await handleMessage(m, c);
    expect(m.reactions).toEqual(['✅']);
    expect(await c.db.hasResult('u1', 1000)).toBe(true);
  });
});
