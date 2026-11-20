import { describe, expect, test } from 'bun:test';
import { cleanGameBonusFor, maxPositionBonus } from '../scoring/models';
import { PRODUCTION_CONFIG, PRODUCTION_MODEL } from '../scoring/production';
import { MISTAKE, NATURAL, B, G, P, Y, makeShare } from './support';

describe('production scoring is locked to model R with the chosen settings', () => {
  test('the model is R', () => {
    expect(PRODUCTION_MODEL.id).toBe('R');
  });

  test('settings chosen from the history analysis', () => {
    expect(PRODUCTION_CONFIG.categoryWeights).toEqual({ Y: 1, G: 2, B: 3, P: 4 });
    expect(PRODUCTION_CONFIG.positionStepWeights).toEqual({ Y: 1, G: 2, B: 3, P: 4 });
    expect(PRODUCTION_CONFIG.weightedPositionBonusPerUnit).toBe(0.25);
    expect(PRODUCTION_CONFIG.mistakePenalty).toBe(1);
    expect(PRODUCTION_CONFIG.rainbowPenalty).toBe(0.5);
    expect(maxPositionBonus(PRODUCTION_CONFIG)).toBe(3.75);
    expect(cleanGameBonusFor(PRODUCTION_CONFIG)).toBe(4);
  });

  const score = (rows: string[]) => PRODUCTION_MODEL.rankKey(makeShare(rows), PRODUCTION_CONFIG)[0];

  test('known scores', () => {
    expect(score(NATURAL)).toBe(14); // 10 + 4 clean
    expect(score([P, B, G, Y])).toBe(17.75); // 10 + 3.75 + 4
    expect(score([MISTAKE, ...NATURAL])).toBe(9);
    expect(score([MISTAKE, MISTAKE, MISTAKE, MISTAKE])).toBe(-4);
  });

  test('a clean game in natural order beats a hardest-first game with a mistake', () => {
    expect(score(NATURAL)).toBeGreaterThan(score([MISTAKE, P, B, G, Y]));
  });
});
