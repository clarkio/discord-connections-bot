import { COLOR_SQUARE } from '../connections/types';
import { toShare } from '../processor';
import { compareKeys } from '../scoring/models';
import { PRODUCTION_CONFIG, PRODUCTION_MODEL } from '../scoring/production';
import { determineWinners } from '../scoring/winners';
import type { ConnectionsDatabase } from '../db/types';
import type { Command, CommandMessage } from './types';

/** Discord rejects messages over 2000 characters; stay a little under. */
const MESSAGE_LIMIT = 1900;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Round away floating-point noise from sums of quarter points. */
const tidy = (n: number) => Number(n.toFixed(2));

/** Names come from Discord and are shown as plain text, so neutralise markdown characters. */
const escapeMarkdown = (name: string) => name.replace(/([\\_*~`|>])/g, '\\$1');

/** Pack lines into messages, starting a new message before one would run over the limit. */
function chunk(lines: string[]): string[] {
  const messages: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current !== '' && current.length + 1 + line.length > MESSAGE_LIMIT) {
      messages.push(current);
      current = line;
    } else {
      current = current === '' ? line : `${current}\n${line}`;
    }
  }
  if (current !== '') messages.push(current);
  return messages;
}

/**
 * All-time standings, ranked by total points. It runs inside Discord, not on a public site, so every
 * player is included whether or not they opted in; ignored players never compete and are left out.
 */
async function allTimeStandings(message: CommandMessage, db: ConnectionsDatabase, ignoredIds: Set<string>): Promise<void> {
  const rows = (await db.getAllTimeStandings())
    .filter((r) => !ignoredIds.has(r.discordId))
    .sort((a, b) => b.totalScore - a.totalScore || b.averageScore - a.averageScore || a.discordName.localeCompare(b.discordName));
  if (rows.length === 0) {
    await message.channel.send('No Connections results yet.');
    return;
  }

  let rank = 0;
  const lines = rows.map((r, i) => {
    if (i === 0 || r.totalScore !== rows[i - 1]!.totalScore) rank = i + 1;
    return `${rank}. ${rank === 1 ? '🏆 ' : ''}${escapeMarkdown(r.discordName)} — ${tidy(r.totalScore)} points · ${plural(r.games, 'puzzle')} · ${tidy(r.averageScore)} average · ${plural(r.wins, 'win')} · ${plural(r.ties, 'tie')}`;
  });

  const header = `**All-time Connections standings** (${plural(rows.length, 'player')}, ranked by total points)`;
  for (const text of chunk([header, ...lines])) await message.channel.send(text);
}

export const standingsCommand: Command = {
  name: 'standings',
  usage: '!standings [puzzle number | all]',
  description: "Everyone's results for a puzzle, ranked (the latest puzzle if you give no number), or `all` for the all-time standings.",
  async execute(message, args, { db, ignoredIds }) {
    const arg = args[0];
    if (arg?.toLowerCase() === 'all') {
      await allTimeStandings(message, db, ignoredIds);
      return;
    }
    if (arg !== undefined && !/^\d+$/.test(arg)) {
      await message.channel.send('Usage: !standings [puzzle number | all]');
      return;
    }

    const puzzleNumber = arg !== undefined ? Number(arg) : (await db.getAllPuzzleNumbers()).at(-1);
    if (puzzleNumber === undefined) {
      await message.channel.send('No Connections results yet.');
      return;
    }

    // Ignored players never compete, so they are not listed or counted.
    const entries = (await db.getPuzzleEntries(puzzleNumber)).filter((e) => !ignoredIds.has(e.discordId));
    if (entries.length === 0) {
      await message.channel.send(`No results found for puzzle #${puzzleNumber}.`);
      return;
    }

    // Rank from the raw results with the live scoring, the same way winners are decided.
    const byId = new Map(entries.map((e) => [e.discordId, e]));
    const { ranking } = determineWinners(
      entries.map((e) => ({ playerId: e.discordId, share: toShare(e) })),
      PRODUCTION_MODEL,
      PRODUCTION_CONFIG,
    );

    let rank = 0;
    const lines = ranking!.map((r, i) => {
      if (i === 0 || compareKeys(r.key, ranking![i - 1]!.key) !== 0) rank = i + 1;
      const e = byId.get(r.playerId)!;
      const { solvedOrder, mistakes, rainbows } = e.result;
      const squares = solvedOrder.map((c) => COLOR_SQUARE[c]).join('');
      return [
        `${rank}. ${rank === 1 ? '🏆 ' : ''}${escapeMarkdown(e.discordName)} — ${r.key[0]} points`,
        `(solved ${solvedOrder.length}/4, ${plural(mistakes + rainbows, 'mistake')})`,
        squares,
        rainbows > 0 ? '🌈' : '',
      ]
        .filter((part) => part !== '')
        .join(' ');
    });

    const header = `**Connections #${puzzleNumber} results** (${plural(entries.length, 'player')})`;
    for (const text of chunk([header, ...lines])) await message.channel.send(text);
  },
};
