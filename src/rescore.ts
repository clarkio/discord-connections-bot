import type { ConnectionsDatabase, PuzzleEntry } from './db/types';
import { refreshOutcomes, toShare } from './processor';
import { PRODUCTION_CONFIG, PRODUCTION_MODEL } from './scoring/production';
import { determineWinners } from './scoring/winners';

/** How puzzles with two or more eligible players were decided. */
export interface DecidedCounts {
  contested: number;
  singleWinner: number;
  tied: number;
}

export interface RescoreSummary {
  /** False for a dry run, where nothing was written. */
  applied: boolean;
  puzzles: number;
  results: number;
  /** Stored daily scores that differ from the live scoring. */
  scoresChanged: number;
  /** Puzzles whose winner, or whether it is a tie, differs from what is stored. */
  winnerChanged: number;
  before: DecidedCounts;
  after: DecidedCounts;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Recompute every stored daily score and win/tie flag from the raw results with the live scoring.
 * With `apply: false` it only reports how things would change. It reads the raw results already in
 * the database, so it does not need Discord, and running it again changes nothing.
 */
export async function rescoreAll(
  db: ConnectionsDatabase,
  ignoredIds: Set<string>,
  options: { apply: boolean; onPuzzle?: (puzzleNumber: number) => void },
): Promise<RescoreSummary> {
  const summary: RescoreSummary = {
    applied: options.apply,
    puzzles: 0,
    results: 0,
    scoresChanged: 0,
    winnerChanged: 0,
    before: { contested: 0, singleWinner: 0, tied: 0 },
    after: { contested: 0, singleWinner: 0, tied: 0 },
  };

  for (const puzzleNumber of await db.getAllPuzzleNumbers()) {
    const entries = await db.getPuzzleEntries(puzzleNumber);
    summary.puzzles++;
    summary.results += entries.length;

    const newScores = entries.map((e) => PRODUCTION_MODEL.rankKey(toShare(e), PRODUCTION_CONFIG)[0]!);
    const changed = entries.flatMap((e, i) => (newScores[i] !== e.dailyScore ? [{ discordId: e.discordId, dailyScore: newScores[i]! }] : []));
    summary.scoresChanged += changed.length;

    // What is stored now, among players who count, against what the live scoring decides.
    const eligible: PuzzleEntry[] = entries.filter((e) => !ignoredIds.has(e.discordId));
    const storedWinners = eligible.filter((e) => e.isWin || e.isTie).map((e) => e.discordId);
    const storedTie = eligible.some((e) => e.isTie);
    const decided = determineWinners(
      eligible.map((e) => ({ playerId: e.discordId, share: toShare(e) })),
      PRODUCTION_MODEL,
      PRODUCTION_CONFIG,
    );

    if (!sameSet(storedWinners, decided.winners) || storedTie !== decided.isTie) summary.winnerChanged++;
    if (eligible.length >= 2) {
      summary.before.contested++;
      summary.after.contested++;
      if (storedWinners.length === 1) summary.before.singleWinner++;
      if (storedTie) summary.before.tied++;
      if (decided.winners.length === 1) summary.after.singleWinner++;
      if (decided.isTie) summary.after.tied++;
    }

    if (options.apply) {
      await db.setDailyScores(puzzleNumber, changed);
      await refreshOutcomes(puzzleNumber, db, ignoredIds);
    }
    options.onPuzzle?.(puzzleNumber);
  }
  return summary;
}
