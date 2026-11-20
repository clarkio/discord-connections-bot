import type { Share } from '../connections/types';
import type { ScoringConfig } from './config';
import { compareKeys, type ScoringModel } from './models';

export interface Entry {
  playerId: string;
  share: Share;
}

export interface RankedEntry extends Entry {
  key: number[];
}

export interface WinnerResult {
  winners: string[];
  isTie: boolean;
  /** All entries, best first. Absent when there were no entries. */
  ranking?: RankedEntry[];
}

/** Rank entries under a model. Equal keys tie, whether or not the puzzle was failed. */
export function determineWinners(entries: Entry[], model: ScoringModel, cfg: ScoringConfig): WinnerResult {
  if (entries.length === 0) return { winners: [], isTie: false };

  const ranking = entries
    .map((e) => ({ ...e, key: model.rankKey(e.share, cfg) }))
    .sort((a, b) => compareKeys(b.key, a.key));

  const top = ranking[0]!.key;
  const winners = ranking.filter((e) => compareKeys(e.key, top) === 0).map((e) => e.playerId);
  return { winners, isTie: winners.length > 1, ranking };
}
