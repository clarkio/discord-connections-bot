import type { ScoreComponent } from './models';

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** One score-breakdown line, e.g. "mistakes -1 (1 × -1)". */
export function describeComponent(c: ScoreComponent): string {
  return `${c.label} ${signed(c.points)} (${c.detail})`;
}
