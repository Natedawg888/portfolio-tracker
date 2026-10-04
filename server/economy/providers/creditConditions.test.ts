/**
 * SLOOS net tightening is flipped so a higher card means easier credit.
 * Run: npm run test:economy
 */
import { parseSloosNetEasing, SLOOS_CI_TIGHTENING } from './creditConditions.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const xml = `<?xml version="1.0"?>
<kf:Series SERIES_NAME="${SLOOS_CI_TIGHTENING}" UNIT="Percentage">
  <frb:Obs OBS_VALUE="10.3" TIME_PERIOD="2011-12-31" />
  <frb:Obs OBS_VALUE="16.1" TIME_PERIOD="2026-03-31" />
  <frb:Obs OBS_VALUE="6.5" TIME_PERIOD="2026-06-30" />
  <frb:Obs OBS_VALUE="7.3" TIME_PERIOD="2026-09-30" />
</kf:Series>`;

let passed = 0;

{
  const rows = parseSloosNetEasing(xml, SLOOS_CI_TIGHTENING);
  assert(rows.length === 3, `dropped the pre-2012 point, got ${rows.length}`);
  assert(rows[0]?.period === '2026-Q1' && rows[0]?.value === -16.1, `q1 ${rows[0]?.period} ${rows[0]?.value}`);
  assert(rows[2]?.period === '2026-Q3' && rows[2]?.value === -7.3, `q3 ${rows[2]?.value}`);
  assert(rows.every((row) => row.frequency === 'quarterly'), 'quarterly');
  passed += 1;
}

{
  let threw = false;
  try {
    parseSloosNetEasing('<kf:Series SERIES_NAME="OTHER"></kf:Series>', SLOOS_CI_TIGHTENING);
  } catch (err) {
    threw = err instanceof Error && err.message.includes(SLOOS_CI_TIGHTENING);
  }
  assert(threw, 'a file without the standards series is an error');
  passed += 1;
}

console.log(`${passed} credit-conditions tests passed`);
