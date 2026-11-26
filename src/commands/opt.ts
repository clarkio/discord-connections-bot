import type { Command } from './types';

function optCommand(name: 'optin' | 'optout', value: boolean): Command {
  const verb = value ? 'opted in' : 'opted out';
  return {
    name,
    usage: `!${name}`,
    description: value
      ? 'Opt in to appear in public leaderboard data. Your results are recorded either way.'
      : 'Opt out of public leaderboard data. Your results are still recorded, and you can still see them with !results.',
    async execute(message, _args, { db }) {
      await db.upsertPlayer(message.author.id, message.author.username);
      const changed = await db.setOptedIn(message.author.id, value);
      const tag = `<@${message.author.id}>`;
      await message.channel.send(
        changed
          ? `${tag} you have successfully ${verb} for showing up in the public leaderboard data`
          : `${tag} you have already ${verb} for showing up in the public leaderboard data`,
      );
    },
  };
}

export const optInCommand = optCommand('optin', true);
export const optOutCommand = optCommand('optout', false);
