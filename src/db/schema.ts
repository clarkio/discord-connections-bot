import { foreignKey, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const playersTable = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  discordId: text('discord_id').notNull().unique(),
  discordName: text('discord_name').notNull(),
  isOptedIn: integer('is_opted_in').notNull().default(0),
});

/** The raw share, exactly as played. Never holds a score, so any scoring can be re-derived from it. */
export const resultsTable = sqliteTable(
  'results',
  {
    discordId: text('discord_id').notNull().references(() => playersTable.discordId),
    puzzleNumber: integer('puzzle_number').notNull(),
    /** Guess rows as colour letters, space-separated, e.g. "YYYG PPPP". */
    guessRows: text('guess_rows').notNull(),
    /** Solved categories in the order they were solved, e.g. "PBGY". */
    solvedOrder: text('solved_order').notNull(),
    mistakes: integer('mistakes').notNull(),
    rainbows: integer('rainbows').notNull(),
    failed: integer('failed').notNull(),
    postedAt: text('posted_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.discordId, t.puzzleNumber] })],
);

/** Derived from a result by the scoring model, plus the outcome for that puzzle. */
export const scoresTable = sqliteTable(
  'scores',
  {
    discordId: text('discord_id').notNull(),
    puzzleNumber: integer('puzzle_number').notNull(),
    dailyScore: real('daily_score').notNull(),
    isWin: integer('is_win').notNull().default(0),
    isTie: integer('is_tie').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.discordId, t.puzzleNumber] }),
    foreignKey({ columns: [t.discordId, t.puzzleNumber], foreignColumns: [resultsTable.discordId, resultsTable.puzzleNumber] }),
  ],
);
