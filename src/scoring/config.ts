import type { Color } from '../connections/types';

/** Settings for model S, the outcome scoring the live bot uses. */
export interface OutcomeConfig {
  /** Points for each group solved. */
  groupPoints: number;
  /** Points lost per mistake; a rainbow guess is a mistake like any other. */
  mistakePenalty: number;
  /** Points per position unit. Larger than the rainbow grace so a better solve order always outranks it. */
  positionUnit: number;
  /** Position units earned per place a group was solved ahead of its natural place, by the group that moved up. */
  stepWeights: Record<Color, number>;
  /** One-time points for a puzzle with any rainbow guess; the last tiebreak, smaller than one position unit. */
  rainbowGrace: number;
  /** Extra points for solving with no mistakes at all. */
  cleanBonus: number;
}

/** Every tunable weight lives here so the analysis can vary them. */
export interface ScoringConfig {
  /** Model D: points for each solved category. */
  categoryWeights: Record<Color, number>;
  /** Model D: points lost per ordinary mistake. */
  mistakePenalty: number;
  /** Model D: points lost per rainbow guess (smaller than an ordinary mistake). */
  rainbowPenalty: number;
  /** Model D: points gained per pair of solved categories where the harder was solved first. */
  orderBonusPerPair: number;
  /** Model P: points gained per place a category was solved ahead of its natural position. */
  positionBonusPerStep: number;
  /** Model Q: how many units one place of position progress is worth, by the category that moved up. */
  positionStepWeights: Record<Color, number>;
  /** Model Q: points per unit. Kept at 0.25 or more so every score difference is a clean multiple. */
  weightedPositionBonusPerUnit: number;
  /** Model R: extra points for a game with no mistakes. 'auto' picks the smallest whole number above the largest position bonus, so a clean game can never lose to a mistaken one. */
  cleanGameBonus: number | 'auto';
  /** Model B: how much of a mistake a rainbow guess counts as. */
  rainbowMistakeWeight: number;
  /** Model B: whether hardest-first solve order breaks otherwise-equal results. */
  orderTiebreak: boolean;
  /** Model S: the live outcome scoring. */
  outcome: OutcomeConfig;
}

export const DEFAULT_CONFIG: ScoringConfig = {
  categoryWeights: { Y: 1, G: 2, B: 3, P: 4 },
  mistakePenalty: 1,
  rainbowPenalty: 0.5,
  orderBonusPerPair: 0.5,
  positionBonusPerStep: 0.25,
  positionStepWeights: { Y: 1, G: 2, B: 3, P: 4 },
  weightedPositionBonusPerUnit: 0.25,
  cleanGameBonus: 'auto',
  rainbowMistakeWeight: 0.5,
  orderTiebreak: true,
  outcome: {
    groupPoints: 10,
    mistakePenalty: 10,
    positionUnit: 0.5,
    stepWeights: { Y: 0, G: 1, B: 2, P: 3 },
    rainbowGrace: 0.25,
    cleanBonus: 5,
  },
};
