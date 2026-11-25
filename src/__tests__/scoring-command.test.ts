import { describe, expect, test } from 'bun:test';
import { EXAMPLE_ROWS, scoringCommand, scoringExplanation } from '../commands/scoring';
import { parseShare } from '../connections/parser';
import { handleMessage } from '../handler';
import { describeComponent } from '../scoring/format';
import { PRODUCTION_CONFIG, PRODUCTION_MODEL } from '../scoring/production';
import { NATURAL, B, G, P, Y, fakeMessage, makeShare, memoryDb, shareText } from './support';

const score = (rows: string[]) => PRODUCTION_MODEL.rankKey(makeShare(rows), PRODUCTION_CONFIG)[0]!;
const [rules, example] = scoringExplanation();

describe('!scoring', () => {
  test('is registered under the name players type', () => {
    expect(scoringCommand.name).toBe('scoring');
    expect(scoringCommand.description.length).toBeGreaterThan(10);
  });

  test('sends the rules and then the worked example, each within Discord\'s 2000-character limit', async () => {
    const m = fakeMessage('!scoring');
    await scoringCommand.execute(m, [], { db: await memoryDb(), ignoredIds: new Set() });
    expect(m.sent).toHaveLength(2);
    expect(m.sent).toEqual([rules!, example!]);
    for (const text of m.sent) expect(text.length).toBeLessThanOrEqual(2000);
  });

  test('works through the message handler, in any letter case', async () => {
    const db = await memoryDb();
    const ctx = { db, ignoredIds: new Set<string>(), taggingEnabled: true, targetChannelId: 'chan' };
    const m = fakeMessage('!Scoring');
    await handleMessage(m, ctx);
    expect(m.sent).toHaveLength(2);
    expect(m.reactions).toEqual([]);
  });

  test('does not tag or reply to a particular person', () => {
    expect(rules).not.toContain('<@');
    expect(example).not.toContain('<@');
  });
});

describe('the rules message', () => {
  test('gives the ranking order: outcome, mistakes, position bonus, rainbow grace', () => {
    const order = ['Outcome', 'mistakes', 'Position bonus', 'Rainbow grace'].map((w) => rules!.indexOf(w));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('says each group is worth, each mistake costs and the clean bonus, from the live settings', () => {
    const o = PRODUCTION_CONFIG.outcome;
    expect(rules).toContain(`${o.groupPoints} points for each group`);
    expect(rules).toContain(`-${o.mistakePenalty} points for each mistake`);
    expect(rules).toContain(`+${o.cleanBonus}`);
    expect(rules).toContain(`+${o.rainbowGrace}`);
  });

  test('gives the highest possible score, which is the perfect reverse with no mistakes', () => {
    const best = score([P, B, G, Y]);
    expect(best).toBe(53.5);
    expect(rules).toContain(String(best));
    expect(rules).toContain('🟪🟦🟩🟨');
  });

  test('explains that the position bonus and the rainbow grace only break ties', () => {
    expect(rules).toMatch(/only (decides|matters|breaks)/i);
  });

  test('explains that a rainbow guess is a row of one square of each colour', () => {
    expect(rules).toContain('🟨🟩🟦🟪');
  });
});

describe('the worked example', () => {
  const parsed = parseShare(shareText(EXAMPLE_ROWS, 1));

  test('is a valid Connections share with one mistake and purple solved first', () => {
    expect(parsed?.status).toBe('ok');
    if (parsed?.status !== 'ok') return;
    expect(parsed.share.mistakes + parsed.share.rainbows).toBe(1);
    expect(parsed.share.solvedOrder[0]).toBe('P');
  });

  test('shows the share as players post it', () => {
    for (const row of EXAMPLE_ROWS) expect(example).toContain(row);
  });

  test('states the score the live scoring gives that share', () => {
    expect(example).toContain(`${score(EXAMPLE_ROWS)} points`);
    expect(score(EXAMPLE_ROWS)).toBe(38);
  });

  test('shows every line of the breakdown exactly as the bot posts it', () => {
    const lines = PRODUCTION_MODEL.breakdown!(makeShare(EXAMPLE_ROWS), PRODUCTION_CONFIG).map((c) => `• ${describeComponent(c)}`);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect(example).toContain(line);
  });

  test('compares with the same mistake solved in natural order, and with a clean game', () => {
    const sameMistakeNatural = score(['🟦🟦🟦🟪', ...NATURAL]);
    const cleanNatural = score(NATURAL);
    expect(sameMistakeNatural).toBe(30);
    expect(cleanNatural).toBe(45);
    expect(example).toContain(String(sameMistakeNatural));
    expect(example).toContain(String(cleanNatural));
  });
});
