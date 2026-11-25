import { parseShare } from '../connections/parser';
import type { Share } from '../connections/types';
import { describeComponent } from '../scoring/format';
import { PRODUCTION_CONFIG, PRODUCTION_MODEL } from '../scoring/production';
import type { Command } from './types';

/** The share used in the worked example: one mistake, purple solved first, then blue, yellow, green. */
export const EXAMPLE_ROWS = ['🟦🟦🟦🟪', '🟪🟪🟪🟪', '🟦🟦🟦🟦', '🟨🟨🟨🟨', '🟩🟩🟩🟩'];

const NATURAL_ROWS = ['🟨🟨🟨🟨', '🟩🟩🟩🟩', '🟦🟦🟦🟦', '🟪🟪🟪🟪'];
const PERFECT_REVERSE_ROWS = ['🟪🟪🟪🟪', '🟦🟦🟦🟦', '🟩🟩🟩🟩', '🟨🟨🟨🟨'];
const ALL_WRONG_ROWS = ['🟨🟨🟩🟩', '🟨🟨🟦🟦', '🟪🟪🟩🟩', '🟦🟪🟦🟪'];

function shareOf(rows: string[]): Share {
  const parsed = parseShare(`Connections\nPuzzle #1\n${rows.join('\n')}`);
  if (parsed?.status !== 'ok') throw new Error('The scoring examples must be valid shares.');
  return parsed.share;
}

const score = (rows: string[]) => PRODUCTION_MODEL.rankKey(shareOf(rows), PRODUCTION_CONFIG)[0]!;

/**
 * The two messages that explain the scoring. Every number comes from the live scoring settings and
 * model, so the explanation cannot drift out of date when the scoring changes.
 */
export function scoringExplanation(): [string, string] {
  const o = PRODUCTION_CONFIG.outcome;
  const best = score(PERFECT_REVERSE_ROWS);
  const worst = score(ALL_WRONG_ROWS);
  const maxBonus = PRODUCTION_MODEL.breakdown!(shareOf(PERFECT_REVERSE_ROWS), PRODUCTION_CONFIG).find((c) => c.label === 'position bonus')!.points;

  const rules = [
    '**How Connections scoring works**',
    'Each puzzle is ranked by these rules in order. The first rule that separates two players decides who ranks higher:',
    '',
    '**1. Outcome.** Solving all four groups beats failing. If both players failed, the one who solved more groups wins.',
    '**2. Fewer mistakes.** Every wrong guess counts, and a rainbow guess (one row with each colour, 🟨🟩🟦🟪) counts as a mistake too. No mistakes at all is a clean game.',
    '**3. Position bonus.** Solving harder groups earlier earns points: 🟪 purple first is best, then 🟦 blue, and the perfect reverse 🟪🟦🟩🟨 earns the most. It only decides between players with the same outcome and the same number of mistakes.',
    '**4. Rainbow grace.** If everything above is equal, a player who guessed a rainbow ranks higher. It only breaks ties and never beats a better solve order.',
    '',
    '**Points** (the score always follows that order)',
    `• ${o.groupPoints} points for each group solved`,
    `• -${o.mistakePenalty} points for each mistake`,
    `• +${o.cleanBonus} for a clean game`,
    `• Position bonus: up to +${maxBonus}`,
    `• Rainbow grace: +${o.rainbowGrace}, once per puzzle`,
    `Highest possible score: ${best} (clean game, 🟪🟦🟩🟨). Lowest: ${worst}.`,
    'Use `!results` to see your own scores.',
  ].join('\n');

  const example = shareOf(EXAMPLE_ROWS);
  const lines = PRODUCTION_MODEL.breakdown!(example, PRODUCTION_CONFIG).map((c) => `• ${describeComponent(c)}`);
  const mistakes = example.mistakes + example.rainbows;
  const sameMistakeNatural = score(['🟦🟦🟦🟪', ...NATURAL_ROWS]);
  const cleanNatural = score(NATURAL_ROWS);
  const worked = [
    '**Example**',
    'This share:',
    '```',
    ...EXAMPLE_ROWS,
    '```',
    `scores **${score(EXAMPLE_ROWS)} points** (solved ${example.solvedOrder.length}/4, ${mistakes} mistake${mistakes === 1 ? '' : 's'}):`,
    ...lines,
    '',
    `The first guess was a mistake, so it cannot beat a clean game (${cleanNatural} points, even in natural order). Solving 🟪 and 🟦 early earned the position bonus: the same mistake with the groups solved in natural order would score ${sameMistakeNatural}.`,
  ].join('\n');

  return [rules, worked];
}

export const scoringCommand: Command = {
  name: 'scoring',
  description: 'Explain how Connections scoring works, with an example',
  async execute(message) {
    for (const text of scoringExplanation()) await message.channel.send(text);
  },
};
