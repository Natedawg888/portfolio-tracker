/**
 * Asset-class copy must stay historical and neutral.
 * Run: npm run test:economy
 */
import { PHASES } from './types.ts';
import { ASSET_CLASS_IDS, assetClassContext } from './assetContext.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const BANNED = [
  /\bbuy\b/i,
  /\bsell\b/i,
  /\bhold\b/i,
  /\brecommend(?:s|ed|ation)?\b/i,
  /move your money/i,
  /you should/i,
  /invest in/i,
];

let passed = 0;
for (const phase of PHASES) {
  const rows = assetClassContext(phase);
  assert(rows.length === ASSET_CLASS_IDS.length, `${phase} row count`);
  const ids = new Set(rows.map((row) => row.id));
  for (const id of ASSET_CLASS_IDS) assert(ids.has(id), `${phase} missing ${id}`);
  for (const row of rows) {
    assert(
      row.tendency === 'positive' || row.tendency === 'neutral' || row.tendency === 'negative',
      `${phase} ${row.id} tendency`,
    );
    assert(row.explanation.length > 40, `${phase} ${row.id} explanation is too short`);
    for (const pattern of BANNED) {
      assert(!pattern.test(row.explanation), `${phase} ${row.id} matches ${pattern}`);
      assert(!pattern.test(row.label), `${phase} ${row.id} label matches ${pattern}`);
    }
  }
  passed += 1;
}

const recoveryEquities = assetClassContext('recovery').find((row) => row.id === 'equities');
assert(
  recoveryEquities?.explanation.includes(
    'Historically, equities have often begun recovering before the broader economy',
  ),
  'recovery equities keep the historical wording',
);
passed += 1;

console.log(`${passed} asset-context tests passed`);
