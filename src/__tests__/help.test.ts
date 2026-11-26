import { describe, expect, test } from 'bun:test';
import { COMMANDS } from '../commands';
import { createHelpCommand } from '../commands/help';
import type { Command } from '../commands/types';
import { handleMessage } from '../handler';
import { fakeMessage, memoryDb } from './support';

const unique = () => [...new Set(COMMANDS.values())];

async function ask(text = '!help') {
  const db = await memoryDb();
  const m = fakeMessage(text);
  await handleMessage(m, { db, ignoredIds: new Set(), taggingEnabled: true, targetChannelId: 'chan' });
  return m.sent;
}

describe('!help', () => {
  test('answers to !help and !commands, in any letter case, with one message', async () => {
    const [first] = await ask('!help');
    expect(first).toBeDefined();
    for (const word of ['!HELP', '!Help', '!commands', '!COMMANDS']) expect(await ask(word)).toEqual([first!]);
  });

  test('lists every command the bot has, with how to type it and what it does', async () => {
    const [text] = await ask();
    for (const c of unique()) {
      expect(text).toContain(`\`${c.usage}\``);
      expect(text).toContain(c.description);
    }
  });

  test('has exactly one line per command', async () => {
    const [text] = await ask();
    const entries = text!.split('\n').filter((line) => line.startsWith('`!'));
    expect(entries).toHaveLength(unique().length);
  });

  test('knows the commands players use', async () => {
    const names = unique().map((c) => c.name).sort();
    expect(names).toEqual(['help', 'optin', 'optout', 'results', 'scoring', 'standings']);
  });

  test('lists help itself', async () => {
    const [text] = await ask();
    expect(text).toContain('`!help`');
  });

  test('keeps the registry order, so the most used commands come first', async () => {
    const [text] = await ask();
    const positions = unique().map((c) => text!.indexOf(`\`${c.usage}\``));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(unique()[0]!.name).toBe('results');
  });

  test('says how a share is scored, since posting one is the main thing players do', async () => {
    const [text] = await ask();
    expect(text).toMatch(/post your Connections result/i);
  });

  test('fits in one Discord message and tags nobody', async () => {
    const [text] = await ask();
    expect(text!.length).toBeLessThanOrEqual(2000);
    expect(text).not.toContain('<@');
  });

  test('a command added to the registry appears without touching the help text', async () => {
    const fake: Command = { name: 'newthing', usage: '!newthing [x]', description: 'Does a new thing.', async execute() {} };
    const help = createHelpCommand(() => [fake]);
    const m = fakeMessage('!help');
    await help.execute(m, [], { db: await memoryDb(), ignoredIds: new Set() });
    expect(m.sent[0]).toContain('`!newthing [x]` — Does a new thing.');
  });
});

describe('every command describes itself', () => {
  test('usage starts with the command name, and the description is a plain sentence', () => {
    for (const c of unique()) {
      expect(c.usage.startsWith(`!${c.name}`)).toBe(true);
      expect(c.description.length).toBeGreaterThan(15);
      expect(c.description.startsWith('!')).toBe(false);
      expect(c.description).not.toContain(c.usage); // the how-to-type part lives in `usage`, not the sentence
    }
  });

  test('an alias points at the same command as its name', () => {
    expect(COMMANDS.get('commands')).toBe(COMMANDS.get('help'));
  });

  test('no two commands share a name or alias', () => {
    const names = unique().flatMap((c) => [c.name, ...(c.aliases ?? [])]);
    expect(new Set(names).size).toBe(names.length);
  });
});
