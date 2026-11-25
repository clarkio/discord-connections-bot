/**
 * One-off: recompute every stored daily score and win/tie flag with the live scoring.
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... bun run history:rescore            # dry run: reports, writes nothing
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... bun run history:rescore --apply    # writes
 *
 * Optional: IGNORED_USER_IDS (same as the bot; ignored players are rescored but never win or tie).
 *
 * It works from the raw results already in the database, so it needs no Discord access. Safe to run
 * again: the second run changes nothing. Back up the database before --apply.
 */
import { TursoDatabase } from '../src/db/turso';
import { parseIgnoredUserIds } from '../src/handler';
import { rescoreAll } from '../src/rescore';

const dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl) {
  console.error('TURSO_DATABASE_URL is required (no local fallback: this must hit the real database).');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const ignoredIds = parseIgnoredUserIds(process.env.IGNORED_USER_IDS);

const db = TursoDatabase.connect(dbUrl, process.env.TURSO_AUTH_TOKEN);
try {
  if (apply) await db.migrate();
  console.log(`${apply ? 'APPLYING to' : 'DRY RUN against'} ${new URL(dbUrl.replace('libsql://', 'https://')).host}\n`);
  let done = 0;
  const s = await rescoreAll(db, ignoredIds, {
    apply,
    onPuzzle: () => {
      if (++done % 100 === 0) console.log(`Processed ${done} puzzles...`);
    },
  });
  const pct = (n: number, of: number) => (of === 0 ? 'n/a' : `${((n / of) * 100).toFixed(1)}%`);
  console.table({
    puzzles: s.puzzles,
    results: s.results,
    'scores that change': s.scoresChanged,
    'puzzles whose winner or tie changes': s.winnerChanged,
    'contested puzzles (2+ players)': s.after.contested,
    'single winner: before': `${s.before.singleWinner} (${pct(s.before.singleWinner, s.before.contested)})`,
    'single winner: after': `${s.after.singleWinner} (${pct(s.after.singleWinner, s.after.contested)})`,
    'tied: before': `${s.before.tied} (${pct(s.before.tied, s.before.contested)})`,
    'tied: after': `${s.after.tied} (${pct(s.after.tied, s.after.contested)})`,
  });
  if (!apply) console.log('Nothing was written. Back up the database, then re-run with --apply.');
} catch (error) {
  console.error('Rescore failed:', error);
  process.exitCode = 1;
} finally {
  db.close();
}
