/**
 * Compare scoring models B and D on an exported history file.
 *
 *   bun run history:analyze [path/to/history.json]
 */
import { readFileSync } from 'node:fs';
import { groupByPuzzle, type HistoryRecord } from '../src/analysis/history';
import { analyze, sweep, type Metrics } from '../src/analysis/metrics';
import { DEFAULT_CONFIG } from '../src/scoring/config';
import { modelB, modelD } from '../src/scoring/models';

const file = process.argv[2] || 'data/history.json';
const { records } = JSON.parse(readFileSync(file, 'utf8')) as { records: HistoryRecord[] };
const groups = groupByPuzzle(records);

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const row = (label: string, m: Metrics) => ({
  config: label,
  puzzles: m.puzzles,
  'single winner': pct(m.singleWinnerRate),
  'avg winners': m.avgWinnerGroupSize.toFixed(2),
  'avg margin': m.avgMargin === null ? 'n/a' : m.avgMargin.toFixed(2),
  'all tied': pct(m.allTiedRate),
});

console.log(`${records.length} shares across ${groups.size} puzzles (metrics cover puzzles with 2+ players)\n`);
console.log('Defaults (primary metric: single winner)');
console.table([row('B ranked tuple', analyze(groups, modelB, DEFAULT_CONFIG)), row('D weighted points', analyze(groups, modelD, DEFAULT_CONFIG))]);

for (const model of [modelB, modelD]) {
  console.log(`\nSensitivity sweep: model ${model.id}`);
  console.table(sweep(groups, model).map((r) => row(r.label, r.metrics)));
}
