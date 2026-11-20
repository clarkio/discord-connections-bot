import { DEFAULT_CONFIG, type ScoringConfig } from '../scoring/config';
import type { ScoringModel } from '../scoring/models';
import { determineWinners, type Entry } from '../scoring/winners';

export interface Metrics {
  /** Puzzles with two or more players; one-player puzzles are trivially decided and excluded. */
  puzzles: number;
  /** Primary metric: share of puzzles with exactly one winner. */
  singleWinnerRate: number;
  avgWinnerGroupSize: number;
  /** Mean gap between first and second place; null for ordinal models with no numeric scale. */
  avgMargin: number | null;
  /** Share of puzzles where every player tied for first. */
  allTiedRate: number;
}

export function analyze(groups: Map<number, Entry[]>, model: ScoringModel, cfg: ScoringConfig): Metrics {
  let puzzles = 0;
  let single = 0;
  let groupSize = 0;
  let allTied = 0;
  let marginSum = 0;

  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    const { winners, ranking } = determineWinners(entries, model, cfg);
    puzzles++;
    groupSize += winners.length;
    if (winners.length === 1) single++;
    if (winners.length === entries.length) allTied++;
    marginSum += ranking![0]!.key[0]! - ranking![1]!.key[0]!;
  }

  const rate = (n: number) => (puzzles === 0 ? 0 : n / puzzles);
  return {
    puzzles,
    singleWinnerRate: rate(single),
    avgWinnerGroupSize: rate(groupSize),
    avgMargin: model.scored ? rate(marginSum) : null,
    allTiedRate: rate(allTied),
  };
}

export interface SweepRow {
  label: string;
  metrics: Metrics;
}

export const ORDER_BONUS_GRID = [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.5, 1];
export const POSITION_BONUS_GRID = [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.5, 1];
export const RAINBOW_PENALTY_GRID = [0, 0.5, 1];

/** Vary the tunable parameters of a model over a small grid. */
export function sweep(groups: Map<number, Entry[]>, model: ScoringModel): SweepRow[] {
  const rows: SweepRow[] = [];
  if (model.id === 'P') {
    for (const positionBonusPerStep of POSITION_BONUS_GRID) {
      for (const rainbowPenalty of RAINBOW_PENALTY_GRID) {
        const cfg = { ...DEFAULT_CONFIG, positionBonusPerStep, rainbowPenalty };
        rows.push({
          label: `positionBonus=${positionBonusPerStep} rainbowPenalty=${rainbowPenalty}`,
          metrics: analyze(groups, model, cfg),
        });
      }
    }
  } else if (model.id === 'D') {
    for (const orderBonusPerPair of ORDER_BONUS_GRID) {
      for (const rainbowPenalty of RAINBOW_PENALTY_GRID) {
        const cfg = { ...DEFAULT_CONFIG, orderBonusPerPair, rainbowPenalty };
        rows.push({
          label: `orderBonus=${orderBonusPerPair} rainbowPenalty=${rainbowPenalty}`,
          metrics: analyze(groups, model, cfg),
        });
      }
    }
  } else {
    for (const orderTiebreak of [false, true]) {
      for (const rainbowMistakeWeight of [0, 0.5, 1]) {
        const cfg = { ...DEFAULT_CONFIG, orderTiebreak, rainbowMistakeWeight };
        rows.push({
          label: `orderTiebreak=${orderTiebreak} rainbowWeight=${rainbowMistakeWeight}`,
          metrics: analyze(groups, model, cfg),
        });
      }
    }
  }
  return rows;
}
