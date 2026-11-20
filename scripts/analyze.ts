/**
 * Compare scoring models B and D on an exported history file.
 *
 *   bun run history:analyze [path/to/history.json] [--model=B|D|P] [--order-bonus=0.25]
 *                           [--position-bonus=0.25] [--rainbow-penalty=0.5] [--examples=2]
 *
 * The flags only affect the example puzzles shown after the first table
 * (defaults: model D with the values in src/scoring/config.ts, 2 per kind).
 */
import { readFileSync } from 'node:fs';
import { groupByPuzzle, type HistoryRecord } from '../src/analysis/history';
import { formatExample, pickExamples } from '../src/analysis/examples';
import { analyze, sweep, type Metrics } from '../src/analysis/metrics';
import { DEFAULT_CONFIG } from '../src/scoring/config';
import { modelB, modelD, modelP } from '../src/scoring/models';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const file = args.find((a) => !a.startsWith('--')) || 'data/history.json';
const exampleModel = { B: modelB, P: modelP }[flag('model')?.toUpperCase() ?? ''] ?? modelD;
const exampleCfg = {
  ...DEFAULT_CONFIG,
  ...(flag('order-bonus') !== undefined && { orderBonusPerPair: Number(flag('order-bonus')) }),
  ...(flag('position-bonus') !== undefined && { positionBonusPerStep: Number(flag('position-bonus')) }),
  ...(flag('rainbow-penalty') !== undefined && { rainbowPenalty: Number(flag('rainbow-penalty')) }),
};
const perKind = Number(flag('examples') ?? 2);
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
console.table([row('B ranked tuple', analyze(groups, modelB, DEFAULT_CONFIG)), row('D pair bonus 0.5', analyze(groups, modelD, DEFAULT_CONFIG)), row('D pair bonus 0.25', analyze(groups, modelD, { ...DEFAULT_CONFIG, orderBonusPerPair: 0.25 })), row('P position bonus 0.25', analyze(groups, modelP, DEFAULT_CONFIG))]);

const examples = pickExamples(groups, exampleModel, exampleCfg, perKind);
const sections: [string, typeof examples.clearWinner][] = [
  ['Clear winner (exactly one player ranked first)', examples.clearWinner],
  ['Tie (two or more share first, but not everyone)', examples.tie],
  ['Everyone tied (nobody stood out)', examples.allTied],
];
console.log(`\nExample puzzles, model ${exampleModel.id} (most players first; 🏆 marks first place)`);
for (const [title, list] of sections) {
  console.log(`\n${title}`);
  console.log(list.length === 0 ? '  none in this history' : list.map((e) => formatExample(e, exampleModel)).join('\n\n'));
}

for (const model of [modelB, modelD, modelP]) {
  console.log(`\nSensitivity sweep: model ${model.id}`);
  console.table(sweep(groups, model).map((r) => row(r.label, r.metrics)));
}
