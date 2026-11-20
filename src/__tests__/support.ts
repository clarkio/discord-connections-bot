import { createClient } from '@libsql/client';
import { parseShare } from '../connections/parser';
import type { Share } from '../connections/types';
import { TursoDatabase } from '../db/turso';

export const Y = '🟨🟨🟨🟨', G = '🟩🟩🟩🟩', B = '🟦🟦🟦🟦', P = '🟪🟪🟪🟪';
export const MISTAKE = '🟨🟨🟨🟩';
export const RAINBOW = '🟨🟩🟦🟪';
export const NATURAL = [Y, G, B, P];

export const shareText = (rows: string[], puzzle = 1000) => `Connections\nPuzzle #${puzzle}\n${rows.join('\n')}`;

export function makeShare(rows: string[], puzzle = 1000): Share {
  const r = parseShare(shareText(rows, puzzle));
  if (r?.status !== 'ok') throw new Error(`bad fixture: ${JSON.stringify(r)}`);
  return r.share;
}

export async function memoryDb(): Promise<TursoDatabase> {
  const db = new TursoDatabase(createClient({ url: ':memory:' }));
  await db.migrate();
  return db;
}

export interface FakeMessage {
  author: { id: string; username: string; bot: boolean };
  content: string;
  channelId: string;
  createdAt: Date;
  reactions: string[];
  sent: string[];
  react(emoji: string): Promise<void>;
  channel: { send(text: string): Promise<void> };
}

export function fakeMessage(content: string, opts: Partial<{ id: string; name: string; bot: boolean; channelId: string; at: Date }> = {}): FakeMessage {
  const m: FakeMessage = {
    author: { id: opts.id ?? 'u1', username: opts.name ?? 'alice', bot: opts.bot ?? false },
    content,
    channelId: opts.channelId ?? 'chan',
    createdAt: opts.at ?? new Date('2026-01-01T00:00:00Z'),
    reactions: [],
    sent: [],
    async react(emoji) { m.reactions.push(emoji); },
    channel: { async send(text) { m.sent.push(text); } },
  };
  return m;
}
