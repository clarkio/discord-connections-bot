import type { Color } from '../connections/types';

/** A share as played, with nothing derived from it. */
export interface StoredResult {
  discordId: string;
  puzzleNumber: number;
  /** Guess rows as colour letters, e.g. ['YYYG', 'PPPP']. */
  guessRows: string[];
  solvedOrder: Color[];
  mistakes: number;
  rainbows: number;
  failed: boolean;
  /** ISO timestamp of the message. */
  postedAt: string;
}

export interface PlayerRecord {
  discordId: string;
  discordName: string;
  isOptedIn: boolean;
}

/** One player's result for one puzzle, with its derived score and outcome. */
export interface PuzzleEntry {
  discordId: string;
  discordName: string;
  result: StoredResult;
  dailyScore: number;
  isWin: boolean;
  isTie: boolean;
}

export interface Outcome {
  discordId: string;
  isWin: boolean;
  isTie: boolean;
}

export interface LeaderboardRow {
  discordName: string;
  games: number;
  totalScore: number;
  averageScore: number;
  wins: number;
  ties: number;
}

export interface ConnectionsDatabase {
  upsertPlayer(discordId: string, discordName: string): Promise<void>;
  getPlayer(discordId: string): Promise<PlayerRecord | undefined>;
  /** Returns true only when the setting actually changed. */
  setOptedIn(discordId: string, isOptedIn: boolean): Promise<boolean>;
  hasResult(discordId: string, puzzleNumber: number): Promise<boolean>;
  /** Stores a result and its score together. Returns false, changing nothing, if the player already has one for that puzzle. */
  saveResult(result: StoredResult, dailyScore: number): Promise<boolean>;
  getPuzzleEntries(puzzleNumber: number): Promise<PuzzleEntry[]>;
  setOutcomes(puzzleNumber: number, outcomes: Outcome[]): Promise<void>;
  /** A player's history, newest puzzle first, whether or not they are opted in. */
  getPlayerEntries(discordId: string): Promise<PuzzleEntry[]>;
  /** Public data: opted-in players only. */
  getPublicLeaderboard(): Promise<LeaderboardRow[]>;
}
