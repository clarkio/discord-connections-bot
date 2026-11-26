import type { PuzzleEntry } from '../db/types';
import type { Command } from './types';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describe(entry: PuzzleEntry): string {
  const { solvedOrder, mistakes, rainbows, puzzleNumber } = entry.result;
  const outcome = entry.isWin ? ', you won this puzzle' : entry.isTie ? ', you tied for the win' : '';
  return `Puzzle #${puzzleNumber}: ${entry.dailyScore} points, solved ${solvedOrder.length}/4, ${plural(mistakes + rainbows, 'mistake')}${outcome}`;
}

export const resultsCommand: Command = {
  name: 'results',
  usage: '!results [puzzle number | first]',
  description: 'Your result for a puzzle (the latest one if you give no number), or your first puzzle with `first`, plus your lifetime totals.',
  async execute(message, args, { db }) {
    const tag = `<@${message.author.id}>`;
    const arg = args[0];
    const wantsFirst = arg?.toLowerCase() === 'first';
    if (arg !== undefined && !wantsFirst && !/^\d+$/.test(arg)) {
      await message.channel.send(`${tag} Usage: !results [puzzle number | first]`);
      return;
    }

    const entries = await db.getPlayerEntries(message.author.id);
    if (entries.length === 0) {
      await message.channel.send(`${tag} no Connections results found yet.`);
      return;
    }

    // "first" is the lowest puzzle number the player has a result for, even if they shared it later than others.
    const wanted = wantsFirst
      ? entries.reduce((first, e) => (e.result.puzzleNumber < first.result.puzzleNumber ? e : first))
      : arg === undefined
        ? entries[0]
        : entries.find((e) => e.result.puzzleNumber === Number(arg));
    if (!wanted) {
      await message.channel.send(`${tag} no result found for puzzle #${arg}.`);
      return;
    }

    const total = entries.reduce((t, e) => t + e.dailyScore, 0);
    const average = Number((total / entries.length).toFixed(2));
    const wins = entries.filter((e) => e.isWin).length;
    const ties = entries.filter((e) => e.isTie).length;
    await message.channel.send(
      `${tag} ${describe(wanted)}\nLifetime: ${plural(entries.length, 'puzzle')}, ${total} points (${average} average), ${plural(wins, 'win')}, ${plural(ties, 'tie')}`,
    );
  },
};
