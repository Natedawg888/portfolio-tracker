/**
 * The diffusion index is arithmetic on the official balance, centred on 50.
 * Run: npm run test:economy
 */
import { diffusionFromBalance } from './businessActivity.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const point = (value: number) => ({
  period: '2026-08',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  value,
  frequency: 'monthly' as const,
});

let passed = 0;

{
  const [neutral, easy, tight] = diffusionFromBalance([point(0), point(10), point(-8)]);
  assert(neutral?.value === 50, `neutral ${neutral?.value}`);
  assert(easy?.value === 55, `plus ten ${easy?.value}`);
  assert(tight?.value === 46, `minus eight ${tight?.value}`);
  passed += 1;
}

console.log(`${passed} business-activity tests passed`);
