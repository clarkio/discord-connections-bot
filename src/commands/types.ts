import type { ConnectionsDatabase } from '../db/types';

export interface CommandMessage {
  author: { id: string; username: string };
  channel: { send(text: string): Promise<void> };
}

export interface Command {
  name: string;
  description: string;
  execute(message: CommandMessage, args: string[], ctx: { db: ConnectionsDatabase }): Promise<void>;
}
