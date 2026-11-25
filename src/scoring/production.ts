import { DEFAULT_CONFIG, type ScoringConfig } from './config';
import { modelS, type ScoringModel } from './models';

/**
 * The scoring the live bot uses: model S, the outcome scoring. Results rank by outcome, then fewer
 * mistakes, then the position bonus, then the rainbow grace. The other models stay in the analysis
 * scripts for reference and are never used here.
 */
export const PRODUCTION_MODEL: ScoringModel = modelS;

export const PRODUCTION_CONFIG: ScoringConfig = {
  ...DEFAULT_CONFIG,
  outcome: {
    groupPoints: 10,
    mistakePenalty: 10,
    positionUnit: 0.5,
    stepWeights: { Y: 0, G: 1, B: 2, P: 3 },
    rainbowGrace: 0.25,
    cleanBonus: 5,
  },
};
