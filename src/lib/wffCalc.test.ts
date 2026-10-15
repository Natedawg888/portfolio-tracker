/**
 * Working for Families estimate (KAN-79), checked against IRD's own published figures:
 * the IR271 "Working for Families weekly payments 2027" chart (April 2026; each row checked at
 * the top of its income band) and the worked examples on IRD's in-work tax credit page.
 * Run: npm run test:wff
 */
import { estimateWff, type WffInput } from './wffCalc.ts';
import { payTaxYearRates } from './payeRates.ts';
import { calcIncomeTax } from './payeCalc.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const rates = payTaxYearRates(2026).wff;
if (!rates) throw new Error('FAIL: 2026/27 Working for Families rates are loaded');
eq(payTaxYearRates(2025).wff, null, '2025/26 is not loaded (shows a dash)');

const older = (n: number) => Array.from({ length: n }, (_, i) => ({ birthMonth: `201${i}-06` }));
const base = (income: number, children: number): WffInput => ({
  taxYearStart: '2026-04-01',
  familyIncome: income,
  familyIncomeTax: calcIncomeTax(income, payTaxYearRates(2026)),
  couple: true,
  children: older(children),
  inPaidWork: true,
  hoursPerWeek: 40,
  mainBenefit: false,
});
const w = (income: number, children: number) => estimateWff(base(income, children), rates).weekly;

// IR271 2027, page 1: FTC and IWTC by family income (top of band) and number of children.
const chart: [number, number, number, number][] = [
  // income (top of band), children, FTC $/wk, IWTC $/wk. A blank cell in the chart is 0.
  [44900, 1, 152, 147],
  [45500, 1, 149, 147],
  [47000, 1, 141, 147],
  [72500, 1, 6, 147],
  [74000, 1, 0, 145],
  [80000, 1, 0, 114],
  [96500, 1, 0, 26],
  [98000, 1, 0, 19],
  [101000, 1, 0, 3],
  [102500, 1, 0, 0],
  [44900, 2, 276, 147],
  [72500, 2, 130, 147],
  [80000, 2, 90, 147],
  [96500, 2, 3, 147],
  [98000, 2, 0, 143],
  [101000, 2, 0, 127],
  [116000, 2, 0, 47],
  [119000, 2, 0, 32],
  [44900, 3, 400, 147],
  [60500, 3, 318, 147],
  [80000, 3, 214, 147],
  [116000, 3, 24, 147],
  [120500, 3, 0, 147],
  [44900, 4, 524, 162],
  [102500, 4, 220, 162],
  [120500, 4, 124, 162],
  [44900, 5, 648, 177],
  [119000, 5, 256, 177],
  [44900, 6, 772, 192],
  [120500, 6, 373, 192],
];
for (const [income, n, ftc, iwtc] of chart) {
  const r = w(income, n);
  eq(r.ftc, ftc, `IR271 FTC, ${n} child(ren) at $${income}`);
  eq(r.iwtc, iwtc, `IR271 IWTC, ${n} child(ren) at $${income}`);
}

// IRD in-work tax credit page, worked example: two children, family income $100,000 →
// $777.50 abatement carried over from the family tax credit, IWTC $6,892.50 a year, $132 a week.
const ex = estimateWff(base(100000, 2), rates);
eq(ex.annual.ftc, 0, 'example: FTC used up');
eq(ex.annual.iwtc, 6892.5, 'example: IWTC a year');
eq(ex.weekly.iwtc, 132, 'example: IWTC a week');
eq(ex.abated.iwtc, 777.5, 'example: abatement carried over');
// Another example on that page: 5 children, income $41,600 → IWTC $9,230 a year, $177 a week.
const five = estimateWff(base(41600, 5), rates);
eq(five.annual.iwtc, 9230, 'example: 5 children IWTC a year');
eq(five.weekly.iwtc, 177, 'example: 5 children IWTC a week');

// IR271 2027, page 2: minimum family tax credit (after income tax only; no ACC).
eq(w(9500, 1).mftc, 540, 'MFTC at $9,500');
eq(w(41483, 1).mftc, 24, 'MFTC at $41,483');
eq(w(43044, 1).mftc, 0, 'no MFTC from $43,044');
eq(estimateWff({ ...base(30000, 1), hoursPerWeek: 25 }, rates).weekly.mftc, 0, 'a couple needs 30 hours between them');
eq(estimateWff({ ...base(30000, 1), couple: false, hoursPerWeek: 25 }, rates).weekly.mftc > 0, true, 'a sole parent needs 20');
const benefit = estimateWff({ ...base(30000, 2), mainBenefit: true }, rates);
eq(benefit.annual.iwtc + benefit.annual.mftc, 0, 'no IWTC or MFTC on a main benefit');
eq(benefit.annual.ftc > 0, true, 'FTC is still paid on a benefit');
eq(estimateWff({ ...base(60000, 2), inPaidWork: false }, rates).annual.iwtc, 0, 'IWTC needs paid work');

// IR271 2027, page 2: Best Start for children born on or after 1 April 2026 (income-tested from birth).
const bs = (income: number, births: string[]) => estimateWff({ ...base(income, 0), children: births.map((b) => ({ birthMonth: b })) }, rates);
// Born April 2026: under 3 all year.
eq(bs(78500, ['2026-04']).weekly.bestStart, 77, 'Best Start 1 child at $78,500');
eq(bs(80000, ['2026-04']).weekly.bestStart, 73, 'Best Start 1 child at $80,000');
eq(bs(98000, ['2026-04', '2024-06']).weekly.bestStart, 78, 'Best Start 2 children at $98,000');
eq(bs(120500, ['2026-04', '2024-06', '2025-01']).weekly.bestStart, 65, 'Best Start 3 children at $120,500');
// Born before 1 April 2026: not income-tested in their 1st year (here April 2026 – February 2027), then tested.
eq(bs(150000, ['2026-03']).annual.bestStart, 3704.25, 'born March 2026: 11 months free, the 12th abated away');
eq(bs(50000, ['2026-03']).annual.bestStart, 4041, 'born March 2026, under the threshold: the full year');
eq(bs(50000, ['2022-06']).annual.bestStart, 0, 'no Best Start once 3 for the whole year');
eq(bs(50000, ['2023-09']).annual.bestStart, 1683.75, 'turns 3 in September 2026: April to August, 5 months');

// Two earners and two children at school: family income $90,000 (e.g. $55,000 + $35,000).
const two = estimateWff(base(90000, 2), rates);
eq(two.annual.ftc, 1972.5, 'two earners: FTC a year');
eq(two.weekly.ftc, 37, 'two earners: FTC a week');
eq(two.weekly.iwtc, 147, 'two earners: full IWTC');
eq(two.weekly.total, 184, 'two earners: total a week');

console.log('wffCalc.test.ts ok');
