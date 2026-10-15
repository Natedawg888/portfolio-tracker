/**
 * Retirement calculator (KAN-58). Run: npm run test:retirement
 */
import { calculateRetirement, realRate, type RetirementInput } from './retirementCalc.ts';

function near(a: number, b: number, msg: string, tol = 0.01): void {
  if (Math.abs(a - b) > tol) throw new Error(`FAIL: ${msg} (got ${a}, expected ${b})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const base: RetirementInput = {
  currentAge: 35,
  retirementAge: 45,
  planUntilAge: 90,
  currentSavings: 10_000,
  contribution: 100,
  contributionPeriod: 'monthly',
  contributionIncreasePct: 0,
  returnBeforePct: 0,
  returnDuringPct: 0,
  inflationPct: 0,
  targetKind: 'amount',
  targetAmount: 0,
  targetIncome: 0,
  otherIncome: 0,
};

// No growth, no inflation: savings plus contributions.
let r = calculateRetirement(base);
near(r.atRetirement, 10_000 + 100 * 120, 'flat saving');
near(r.totalContributed, 22_000, 'contributed');
assert(r.yearsToRetirement === 10 && r.rows[0].age === 36 && r.rows[9].age === 45, 'one row a year from next birthday');

// Weekly contributions are spread over the year: 52 × 25 = 1,300 a year.
near(calculateRetirement({ ...base, currentSavings: 0, contribution: 25, contributionPeriod: 'weekly' }).atRetirement, 13_000, 'weekly');

// Real rate and compounding: 6% nominal, no inflation, lump sum.
near(realRate(5, 2), 1.05 / 1.02 - 1, 'real rate', 1e-12);
r = calculateRetirement({ ...base, contribution: 0, returnBeforePct: 6 });
near(r.atRetirement, 10_000 * 1.06 ** 10, 'lump sum grows at the yearly rate');
// With inflation, results are in today's dollars; the nominal figure adds inflation back.
r = calculateRetirement({ ...base, contribution: 0, returnBeforePct: 6, inflationPct: 2 });
near(r.atRetirement, 10_000 * (1.06 / 1.02) ** 10, "today's dollars");
near(r.atRetirementNominal, 10_000 * 1.06 ** 10, 'nominal at retirement', 0.05);

// Contributions are in today's dollars: with the return equal to inflation (0% real), the
// balance is exactly what went in, whatever inflation is.
near(calculateRetirement({ ...base, returnBeforePct: 3, inflationPct: 3 }).atRetirement, 22_000, 'contributions keep pace with inflation');
// The default example, checked by hand: lump sum and monthly annuity at the real rate.
{
  const real = 1.06 / 1.02 - 1;
  const rm = (1 + real) ** (1 / 12) - 1;
  const r35 = calculateRetirement({ ...base, retirementAge: 65, currentAge: 30, currentSavings: 20_000, contribution: 300, returnBeforePct: 6, inflationPct: 2 });
  near(r35.atRetirement, 20_000 * (1 + real) ** 35 + 300 * (((1 + rm) ** 420 - 1) / rm), 'hand-checked example');
}

// Contribution increases happen once a year: 1,200 then 1,320 (10%).
near(calculateRetirement({ ...base, currentSavings: 0, retirementAge: 37, contributionIncreasePct: 10 }).atRetirement, 1_200 + 1_320, 'yearly increase');

// Income target: the target is exactly what pays the income to the plan-until age.
const income: RetirementInput = { ...base, targetKind: 'income', targetIncome: 40_000, otherIncome: 10_000, returnDuringPct: 4, planUntilAge: 70 };
r = calculateRetirement(income);
near(r.yearlyDraw, 30_000, 'draw is income minus other income');
const funded = calculateRetirement({ ...income, currentSavings: r.target, contribution: 0 });
assert(funded.onTrack && funded.runsOutAge === null, 'a funded target lasts to the plan-until age');
near(funded.rows[funded.rows.length - 1].balance, 0, 'and is used up by then', 1);
assert(funded.rows[funded.rows.length - 1].age === 70, 'rows run to the plan-until age');

// Short: money runs out early, and the extra contribution closes the gap.
const short = calculateRetirement({ ...income, currentSavings: 50_000 });
assert(!short.onTrack && short.gap < 0 && short.runsOutAge != null && short.runsOutAge < 70, 'runs out before 70');
assert(short.extraNeeded > 0, 'extra needed');
const fixed = calculateRetirement({ ...income, currentSavings: 50_000, contribution: 100 + short.extraNeeded });
assert(fixed.onTrack && fixed.runsOutAge === null, 'adding the extra puts it on track');
near(fixed.gap, 0, 'and only just', 15);

// Other income covers everything: nothing needed.
r = calculateRetirement({ ...income, otherIncome: 50_000 });
assert(r.target === 0 && r.onTrack && r.extraNeeded === 0 && r.yearlyDraw === 0, 'no draw needed');

// Already at retirement age: the balance is today's savings.
r = calculateRetirement({ ...base, retirementAge: 35 });
assert(r.atRetirement === 10_000 && r.yearsToRetirement === 0, 'already retired');

console.log('retirement calculator: ok');
