import type { Command } from './types';

function optCommand(name: 'optin' | 'optout', value: boolean): Command {
  const verb = value ? 'opted in' : 'opted out';
  return {
    name,
    description: value
      ? 'Opt in to your stats showing in the public leaderboard data'
      : 'Opt out of your stats showing in the public leaderboard data',
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
