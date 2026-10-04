/**
 * The sample provider must stay labelled and must not be the default.
 * Run: npm run test:economy
 */
import { buildSampleObservations, getEconomicProvider } from './index.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const previous = process.env.ECONOMY_PROVIDER;
delete process.env.ECONOMY_PROVIDER;
try {
  const live = getEconomicProvider();
  assert(live.id === 'nz-public', `default provider ${live.id}`);
  assert(live.kind === 'live', `default kind ${live.kind}`);

  process.env.ECONOMY_PROVIDER = 'sample';
  const sample = getEconomicProvider();
  assert(sample.kind === 'sample', `sample kind ${sample.kind}`);
  const rows = buildSampleObservations('2020-01-15T00:00:00.000Z');
  assert(rows.length > 0, 'sample rows');
  assert(
    rows.every((row) => row.providerKind === 'sample' && row.source.includes('Sample fixture')),
    'sample rows must identify themselves',
  );
  assert(rows.every((row) => row.period.startsWith('2019')), 'sample periods are not presented as current');
  console.log('1 sample-provider test passed');
} finally {
  if (previous === undefined) delete process.env.ECONOMY_PROVIDER;
  else process.env.ECONOMY_PROVIDER = previous;
}
