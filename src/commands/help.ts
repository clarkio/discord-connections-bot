import type { Command } from './types';

/**
 * `!help`: lists the bot's commands and what each does. The list is built from the commands themselves
 * each time it runs, so a new command shows up here without anyone editing this file.
 */
export function createHelpCommand(getCommands: () => Iterable<Command>): Command {
  return {
    name: 'help',
    usage: '!help',
    description: 'Show this list of commands.',
    aliases: ['commands'],
    async execute(message) {
      // An alias maps to the same command object, so each command is listed once.
      const entries = [...new Set(getCommands())].map((c) => `\`${c.usage}\` — ${c.description}`);
      await message.channel.send(
        ['**Connections bot commands**', ...entries, 'Post your Connections result in this channel and the bot scores it.'].join('\n'),
      );
    },
  };
}
