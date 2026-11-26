import type { ConnectionsDatabase } from '../db/types';

export interface CommandMessage {
  author: { id: string; username: string };
  channel: { send(text: string): Promise<void> };
}

export interface Command {
  name: string;
  /** How to type it, for example `!results [puzzle number | first]`. */
  usage: string;
  /** One plain sentence on what it does, shown by !help. */
  description: string;
  /** Other names that run the same command. */
  aliases?: string[];
  execute(message: CommandMessage, args: string[], ctx: { db: ConnectionsDatabase; ignoredIds: Set<string> }): Promise<void>;
}
