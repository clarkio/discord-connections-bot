import { DEFAULT_CONFIG, type ScoringConfig } from './config';
import { modelR, type ScoringModel } from './models';

/**
 * The scoring the live bot uses, locked from the history analysis: model R
 * (position bonus weighted by difficulty plus a clean game bonus). The other
 * models stay in the analysis scripts for reference and are never used here.
 */
export const PRODUCTION_MODEL: ScoringModel = modelR;

export const PRODUCTION_CONFIG: ScoringConfig = {
  ...DEFAULT_CONFIG,
  categoryWeights: { Y: 1, G: 2, B: 3, P: 4 },
  mistakePenalty: 1,
  rainbowPenalty: 0.5,
  positionStepWeights: { Y: 1, G: 2, B: 3, P: 4 },
  weightedPositionBonusPerUnit: 0.25,
  cleanGameBonus: 'auto',
};
