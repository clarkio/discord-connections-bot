import { describe, expect, test } from 'bun:test';
import { PRODUCTION_CONFIG, PRODUCTION_MODEL } from '../scoring/production';
import { MISTAKE, NATURAL, B, G, P, RAINBOW, Y, makeShare } from './support';

describe('production scoring is locked to model S with the agreed settings', () => {
  test('the model is S', () => {
    expect(PRODUCTION_MODEL.id).toBe('S');
  });

  test('the agreed settings', () => {
    expect(PRODUCTION_CONFIG.outcome).toEqual({
      groupPoints: 10,
      mistakePenalty: 10,
      positionUnit: 0.5,
      stepWeights: { Y: 0, G: 1, B: 2, P: 3 },
      rainbowGrace: 0.25,
      cleanBonus: 5,
    });
  });

  const score = (rows: string[]) => PRODUCTION_MODEL.rankKey(makeShare(rows), PRODUCTION_CONFIG)[0];

  test('known scores', () => {
    expect(score(NATURAL)).toBe(45);
    expect(score([P, B, G, Y])).toBe(53.5);
    expect(score([MISTAKE, ...NATURAL])).toBe(30);
    expect(score([RAINBOW, ...NATURAL])).toBe(30.25);
    expect(score([MISTAKE, MISTAKE, MISTAKE, MISTAKE])).toBe(-40);
  });

  test('a clean game in natural order beats a hardest-first game with a mistake', () => {
    expect(score(NATURAL)).toBeGreaterThan(score([MISTAKE, P, B, G, Y]));
  });

  test('a better solve order beats a rainbow guess with the same number of mistakes', () => {
    expect(score([MISTAKE, P, B, G, Y])).toBeGreaterThan(score([RAINBOW, ...NATURAL]));
    expect(score([RAINBOW, P, B, G, Y])).toBeGreaterThan(score([MISTAKE, P, B, G, Y]));
  });
});
