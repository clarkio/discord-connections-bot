import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { Color } from '../connections/types';
import { playersTable, resultsTable, scoresTable } from './schema';
import type { ConnectionsDatabase, LeaderboardRow, Outcome, PlayerRecord, PuzzleEntry, StoredResult } from './types';

const MIGRATIONS = new URL('../../migrations', import.meta.url).pathname;

export class TursoDatabase implements ConnectionsDatabase {
  private db: LibSQLDatabase;

  constructor(private client: Client) {
    this.db = drizzle(client);
  }

  /** Connect from TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. */
  static connect(url: string, authToken?: string): TursoDatabase {
    // A local file database needs its folder to exist.
    if (url.startsWith('file:')) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
    return new TursoDatabase(createClient({ url, authToken }));
  }

  async migrate(): Promise<void> {
    await migrate(this.db, { migrationsFolder: MIGRATIONS });
  }

  close(): void {
    this.client.close();
  }

  /** Test support: run a read-only query and return plain row objects. */
  async rawQuery(query: string): Promise<Record<string, unknown>[]> {
    const rs = await this.client.execute(query);
    return rs.rows.map((r) => ({ ...r }));
  }

  async upsertPlayer(discordId: string, discordName: string): Promise<void> {
    await this.db
      .insert(playersTable)
      .values({ discordId, discordName })
      .onConflictDoUpdate({ target: playersTable.discordId, set: { discordName } });
  }

  async getPlayer(discordId: string): Promise<PlayerRecord | undefined> {
    const [row] = await this.db.select().from(playersTable).where(eq(playersTable.discordId, discordId));
    return row && { discordId: row.discordId, discordName: row.discordName, isOptedIn: row.isOptedIn === 1 };
  }

  async setOptedIn(discordId: string, isOptedIn: boolean): Promise<boolean> {
    const value = isOptedIn ? 1 : 0;
    const changed = await this.db
      .update(playersTable)
      .set({ isOptedIn: value })
      .where(and(eq(playersTable.discordId, discordId), sql`${playersTable.isOptedIn} != ${value}`))
      .returning({ id: playersTable.id });
    return changed.length > 0;
  }

  async hasResult(discordId: string, puzzleNumber: number): Promise<boolean> {
    const rows = await this.db
      .select({ n: resultsTable.puzzleNumber })
      .from(resultsTable)
      .where(and(eq(resultsTable.discordId, discordId), eq(resultsTable.puzzleNumber, puzzleNumber)));
    return rows.length > 0;
  }

  async saveResult(r: StoredResult, dailyScore: number): Promise<boolean> {
    // One batch so the result and its score are stored together or not at all.
    const [inserted] = await this.db.batch([
      this.db
        .insert(resultsTable)
        .values({
          discordId: r.discordId,
          puzzleNumber: r.puzzleNumber,
          guessRows: r.guessRows.join(' '),
          solvedOrder: r.solvedOrder.join(''),
          mistakes: r.mistakes,
          rainbows: r.rainbows,
          failed: r.failed ? 1 : 0,
          postedAt: r.postedAt,
        })
        .onConflictDoNothing()
        .returning({ n: resultsTable.puzzleNumber }),
      this.db
        .insert(scoresTable)
        .values({ discordId: r.discordId, puzzleNumber: r.puzzleNumber, dailyScore })
        .onConflictDoNothing(),
    ]);
    return inserted.length > 0;
  }

  private entryQuery() {
    return this.db
      .select({
        discordId: resultsTable.discordId,
        discordName: playersTable.discordName,
        puzzleNumber: resultsTable.puzzleNumber,
        guessRows: resultsTable.guessRows,
        solvedOrder: resultsTable.solvedOrder,
        mistakes: resultsTable.mistakes,
        rainbows: resultsTable.rainbows,
        failed: resultsTable.failed,
        postedAt: resultsTable.postedAt,
        dailyScore: scoresTable.dailyScore,
        isWin: scoresTable.isWin,
        isTie: scoresTable.isTie,
      })
      .from(resultsTable)
      .innerJoin(playersTable, eq(playersTable.discordId, resultsTable.discordId))
      .innerJoin(
        scoresTable,
        and(eq(scoresTable.discordId, resultsTable.discordId), eq(scoresTable.puzzleNumber, resultsTable.puzzleNumber)),
      );
  }

  private toEntry(row: Awaited<ReturnType<ReturnType<TursoDatabase['entryQuery']>['execute']>>[number]): PuzzleEntry {
    return {
      discordId: row.discordId,
      discordName: row.discordName,
      dailyScore: row.dailyScore,
      isWin: row.isWin === 1,
      isTie: row.isTie === 1,
      result: {
        discordId: row.discordId,
        puzzleNumber: row.puzzleNumber,
        guessRows: row.guessRows === '' ? [] : row.guessRows.split(' '),
        solvedOrder: row.solvedOrder.split('').filter(Boolean) as Color[],
        mistakes: row.mistakes,
        rainbows: row.rainbows,
        failed: row.failed === 1,
        postedAt: row.postedAt,
      },
    };
  }

  async getPuzzleEntries(puzzleNumber: number): Promise<PuzzleEntry[]> {
    const rows = await this.entryQuery()
      .where(eq(resultsTable.puzzleNumber, puzzleNumber))
      .orderBy(asc(resultsTable.postedAt), asc(resultsTable.discordId));
    return rows.map((r) => this.toEntry(r));
  }

  async setOutcomes(puzzleNumber: number, outcomes: Outcome[]): Promise<void> {
    if (outcomes.length === 0) return;
    const [first, ...rest] = outcomes.map((o) =>
      this.db
        .update(scoresTable)
        .set({ isWin: o.isWin ? 1 : 0, isTie: o.isTie ? 1 : 0 })
        .where(and(eq(scoresTable.discordId, o.discordId), eq(scoresTable.puzzleNumber, puzzleNumber))),
    );
    await this.db.batch([first!, ...rest]);
  }

  async getAllPuzzleNumbers(): Promise<number[]> {
    const rows = await this.db
      .selectDistinct({ n: resultsTable.puzzleNumber })
      .from(resultsTable)
      .orderBy(asc(resultsTable.puzzleNumber));
    return rows.map((r) => r.n);
  }

  async setDailyScores(puzzleNumber: number, scores: { discordId: string; dailyScore: number }[]): Promise<void> {
    if (scores.length === 0) return;
    const [first, ...rest] = scores.map((s) =>
      this.db
        .update(scoresTable)
        .set({ dailyScore: s.dailyScore })
        .where(and(eq(scoresTable.discordId, s.discordId), eq(scoresTable.puzzleNumber, puzzleNumber))),
    );
    await this.db.batch([first!, ...rest]);
  }

  async getPlayerEntries(discordId: string): Promise<PuzzleEntry[]> {
    const rows = await this.entryQuery().where(eq(resultsTable.discordId, discordId)).orderBy(desc(resultsTable.puzzleNumber));
    return rows.map((r) => this.toEntry(r));
  }

  async getPublicLeaderboard(): Promise<LeaderboardRow[]> {
    const rows = await this.db
      .select({
        discordId: playersTable.discordId,
        discordName: playersTable.discordName,
        games: sql<number>`count(*)`,
        totalScore: sql<number>`sum(${scoresTable.dailyScore})`,
        wins: sql<number>`sum(${scoresTable.isWin})`,
        ties: sql<number>`sum(${scoresTable.isTie})`,
      })
      .from(playersTable)
      .innerJoin(scoresTable, eq(scoresTable.discordId, playersTable.discordId))
      .where(eq(playersTable.isOptedIn, 1))
      .groupBy(playersTable.discordId)
      .orderBy(desc(sql`sum(${scoresTable.dailyScore})`));
    return rows.map((r) => ({
      discordId: r.discordId,
      discordName: r.discordName,
      games: Number(r.games),
      totalScore: Number(r.totalScore),
      averageScore: Number(r.totalScore) / Number(r.games),
      wins: Number(r.wins),
      ties: Number(r.ties),
    }));
  }
}
