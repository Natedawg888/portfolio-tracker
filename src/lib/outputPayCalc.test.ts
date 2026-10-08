/**
 * Piece rate, schedular, and share-of-catch pay (KAN-70).
 * Run: npm run test:output-pay
 */
import { calculatePaye } from './payeCalc.ts';
import {
  calculatePieceRate,
  calculateSchedular,
  calculateShareOfCatch,
  outputPaySourceFigures,
  payRange,
  pieceRateGross,
  weeklyToMonthly,
  type PieceRatePayeOptions,
} from './outputPayCalc.ts';
import { PAY_TAX_YEARS, payTaxYearRates } from './payeRates.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number, msg: string, tol = 0.005): void {
  if (actual == null || Math.abs(actual - expected) > tol) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

const rates = payTaxYearRates(2026);
assert(rates === PAY_TAX_YEARS[2026], 'rates come from the 2026 tax-year config');
eq(rates.minimumWageAdultHourly, 23.95, 'adult minimum wage 2026/27');
assert(payTaxYearRates(1999) === PAY_TAX_YEARS[2026], 'unknown year falls back to current config');

const payeOptions: PieceRatePayeOptions = {
  employment: 'primary',
  secondaryTotalAnnualIncome: 0,
  otherAnnualGross: 0,
  kiwiSaverOptIn: true,
  kiwiSaverEmployeeRatePct: 3.5,
  kiwiSaverEmployerRatePct: 3.5,
  salarySacrifice: false,
  studentLoan: true,
  ietc: true,
  payrollGivingAnnual: 0,
};

// Piece-rate gross and effective hourly: $30/bin × 8 bins/day × 5 days, 40 h/week.
{
  const g = pieceRateGross({ ratePerUnit: 30, unitsPerWeek: 40, hoursPerWeek: 40, holidayPayWithWages: false }, rates);
  eq(g.pieceEarnings, 1200, 'piece earnings');
  eq(g.effectiveHourly, 30, 'effective hourly');
  assert(!g.belowMinimumWage, 'above minimum wage');
  eq(g.topUp, 0, 'no top-up');
  eq(g.weeklyGross, 1200, 'weekly gross');
  eq(g.annualGross, 62400, 'annual gross');
}

// Minimum wage top-up: $2/punnet × 300 punnets in 40 h = $600 → $15/h, below $23.95.
{
  const g = pieceRateGross({ ratePerUnit: 2, unitsPerWeek: 300, hoursPerWeek: 40, holidayPayWithWages: false }, rates);
  eq(g.pieceEarnings, 600, 'low piece earnings');
  eq(g.effectiveHourly, 15, 'low effective hourly');
  assert(g.belowMinimumWage, 'below minimum wage');
  eq(g.minimumForHours, 958, 'minimum for 40 h at $23.95');
  eq(g.topUp, 358, 'top-up to minimum');
  eq(g.earnings, 958, 'topped-up earnings');
  eq(g.weeklyGross, 958, 'gross is topped-up figure');
}

// Holiday pay 8% on topped-up earnings.
{
  const g = pieceRateGross({ ratePerUnit: 2, unitsPerWeek: 300, hoursPerWeek: 40, holidayPayWithWages: true }, rates);
  eq(g.holidayPay, 76.64, '8% of $958');
  eq(g.weeklyGross, 1034.64, 'gross incl. holiday pay');
  const h = pieceRateGross({ ratePerUnit: 30, unitsPerWeek: 40, hoursPerWeek: 40, holidayPayWithWages: true }, rates);
  eq(h.holidayPay, 96, '8% of $1,200');
  eq(h.weeklyGross, 1296, 'gross incl. holiday pay (no top-up)');
}

// Zero hours: no effective hourly, no minimum-wage flag.
{
  const g = pieceRateGross({ ratePerUnit: 10, unitsPerWeek: 5, hoursPerWeek: 0, holidayPayWithWages: false }, rates);
  assert(g.effectiveHourly === null, 'no hourly when hours are 0');
  assert(!g.belowMinimumWage, 'no minimum flag without hours');
}

// Parity with the salary tool for the same gross.
{
  const piece = calculatePieceRate({ ratePerUnit: 30, unitsPerWeek: 40, hoursPerWeek: 40, holidayPayWithWages: false }, payeOptions, rates);
  const salary = calculatePaye({ ...payeOptions, amount: 62400, frequency: 'year', hoursPerWeek: 40 });
  eq(piece.paye.annualGross, salary.annualGross, 'parity: annual gross');
  eq(piece.paye.incomeTax, salary.incomeTax, 'parity: income tax');
  eq(piece.paye.acc, salary.acc, 'parity: ACC');
  eq(piece.paye.kiwiSaverEmployee, salary.kiwiSaverEmployee, 'parity: KiwiSaver');
  eq(piece.paye.studentLoan, salary.studentLoan, 'parity: student loan');
  eq(piece.paye.takeHome, salary.takeHome, 'parity: take-home');
  eq(piece.weeklyTakeHome, salary.takeHome / 52, 'weekly take-home');
  assert(piece.paye.taxCode === salary.taxCode, 'parity: tax code');
}

// Schedular withholding, not GST registered: $45/job × 20 jobs at 20%.
{
  const r = calculateSchedular({ ratePerUnit: 45, unitsPerWeek: 20, withholdingRatePct: 20, gstRegistered: false }, rates);
  eq(r.weeklyGross, 900, 'schedular gross');
  eq(r.weeklyGst, 0, 'no GST');
  eq(r.weeklyTaxWithheld, 180, 'withheld 20%');
  eq(r.weeklyPaid, 720, 'paid');
  eq(r.weeklyNet, 720, 'net');
  eq(r.annualNet, 37440, 'annual net');
  assert(!r.notes.some((n) => /PAYE.*deducted from/i.test(n)), 'no PAYE figure');
}

// Schedular, GST registered: withholding on GST-exclusive amount.
{
  const r = calculateSchedular({ ratePerUnit: 45, unitsPerWeek: 20, withholdingRatePct: 15, gstRegistered: true }, rates);
  eq(r.weeklyGst, 135, 'GST 15% of $900');
  eq(r.weeklyInvoice, 1035, 'invoice incl. GST');
  eq(r.weeklyTaxWithheld, 135, 'withheld 15% of GST-exclusive $900');
  eq(r.weeklyPaid, 900, 'paid = invoice − withholding');
  eq(r.weeklyNet, 765, 'net excl. GST');
  assert(r.notes.some((n) => n.includes('GST-exclusive')), 'GST note');
}

// Tailored rate below elected minimum is flagged.
{
  const r = calculateSchedular({ ratePerUnit: 100, unitsPerWeek: 1, withholdingRatePct: 5, gstRegistered: false }, rates);
  eq(r.weeklyTaxWithheld, 5, '5% tailored');
  assert(r.notes.some((n) => n.includes('IR23BS')), 'tailored-rate note');
}

// Share of catch: $6,000/trip × 1.5 trips × 12% share − $80 expenses.
{
  const r = calculateShareOfCatch({ catchValue: 6000, per: 'trip', tripsPerWeek: 1.5, sharePct: 12, expensesPerWeek: 80 });
  eq(r.weeklyCatchValue, 9000, 'weekly catch');
  eq(r.weeklyShare, 1080, '12% share');
  eq(r.weeklyNet, 1000, 'share − expenses');
  eq(r.annualNet, 52000, 'annual net');
  // 15,600 × 10.5% + (52,000 − 15,600) × 17.5% = 1,638 + 6,370
  eq(r.estimatedAnnualIncomeTax, 8008, 'estimated income tax');
  const w = calculateShareOfCatch({ catchValue: 9000, per: 'week', tripsPerWeek: 0, sharePct: 12, expensesPerWeek: 0 });
  eq(w.weeklyShare, 1080, 'per-week catch value');
}

// Variable output: low / typical / high.
{
  const range = payRange(40, 25, null, (units) => {
    const r = calculatePieceRate({ ratePerUnit: 30, unitsPerWeek: units, hoursPerWeek: 40, holidayPayWithWages: false }, payeOptions, rates);
    return { weeklyGross: r.weeklyGross, weeklyNet: r.weeklyTakeHome };
  });
  assert(range.length === 2, 'blank high skipped');
  assert(range[0].label === 'Low' && range[1].label === 'Typical', 'order low → typical');
  eq(range[0].weeklyGross, 958, 'low week topped up to minimum wage (25 × $30 = $750 < $958)');
  eq(range[1].weeklyGross, 1200, 'typical week');
  assert(range[0].weeklyNet < range[1].weeklyNet, 'low nets less than typical');
}

// Saved-source figures match the calculators.
{
  const piece = outputPaySourceFigures({
    payType: 'piece',
    unit: 'bin',
    piece: { ratePerUnit: 30, unitsPerWeek: 40, hoursPerWeek: 40, holidayPayWithWages: false },
    paye: payeOptions,
  });
  eq(piece.weeklyGross, 1200, 'source piece gross');
  const sched = outputPaySourceFigures({
    payType: 'schedular',
    unit: 'job',
    activityNumber: 25,
    schedular: { ratePerUnit: 45, unitsPerWeek: 20, withholdingRatePct: 20, gstRegistered: true },
  });
  eq(sched.weeklyNet, 720, 'source schedular net excludes GST');
  const share = outputPaySourceFigures({
    payType: 'share_of_catch',
    shareOfCatch: { catchValue: 9000, per: 'week', tripsPerWeek: 0, sharePct: 12, expensesPerWeek: 80 },
  });
  eq(share.weeklyNet, 1000, 'source share net');
  eq(weeklyToMonthly(1000), 4333.33, 'weekly → monthly (52/12)');
}

console.log('output pay calc: ok');
