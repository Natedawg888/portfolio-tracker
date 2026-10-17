/**
 * PAYE engine locks. Run: npm run test:paye
 * Figures come from calculatePaye / calcIetc / calcAcc. This file does not
 * change the engine; if a locked number moves, the test fails with both values.
 */
import { calcAcc, calcIetc, calculatePaye } from './payeCalc.ts';
import { defaultPayePrefs } from './payePrefs.ts';
import { PAY_TAX_YEAR_OPTIONS, payTaxYearRates, taxYearForDate } from './payeRates.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
  }
}

const base = {
  amount: 55000,
  frequency: 'year' as const,
  hoursPerWeek: 40,
  employment: 'primary' as const,
  secondaryTotalAnnualIncome: 0,
  otherAnnualGross: 0,
  kiwiSaverOptIn: true,
  kiwiSaverEmployeeRatePct: 3.5,
  kiwiSaverEmployerRatePct: 3.5,
  salarySacrifice: false,
  ietc: true,
  payrollGivingAnnual: 0,
};

const off = calculatePaye({ ...base, studentLoan: false });
eq(off.takeHome, 43912, 'take-home at $55,000');
eq(off.incomeTax, 8720.5, 'income tax at $55,000');
eq(off.acc, 962.5, 'ACC at $55,000');
eq(off.ietcCredit, 520, 'IETC at $55,000');
eq(off.kiwiSaverEmployee, 1925, 'employee KiwiSaver 3.5%');
eq(off.taxCode, 'ME', 'tax code ME');
eq(off.kiwiSaverEmployer, 1925, 'employer KiwiSaver 3.5%');

const on = calculatePaye({ ...base, studentLoan: true });
eq(on.taxCode, 'ME SL', 'student loan on uses tax code ME SL');

eq(calcIetc(68000), 260, 'IETC abates to 260 at $68,000');
eq(calcIetc(70000), 0, 'IETC is 0 at $70,000');

const aboveBand = calculatePaye({ ...base, amount: 80000, studentLoan: false });
const ietcNote = aboveBand.notes.find((n) => n.startsWith('IETC not applied'));
if (!ietcNote) throw new Error('FAIL: income past the IETC end should say why it was not applied');
if (!/abates/i.test(ietcNote)) throw new Error(`FAIL: IETC note should describe the abatement (${ietcNote})`);
if (ietcNote.includes('69,999')) throw new Error('FAIL: IETC note must not use a $69,999 ceiling');
if (off.notes.some((n) => n.includes('69,999'))) throw new Error('FAIL: the $55,000 case must not mention a $69,999 ceiling');
eq(calcAcc(200000), 2741.22, 'ACC at $200,000 is the published maximum levy');
eq(defaultPayePrefs().amount, '75000', 'default salary stays 75000');

// Tax years (KAN-79): 2025/26 uses that year's published ACC and KiwiSaver minimum; brackets are the same.
const y25 = calculatePaye({ ...base, taxYear: 2025, kiwiSaverEmployeeRatePct: 3, kiwiSaverEmployerRatePct: 0, studentLoan: false });
eq(y25.incomeTax, 8720.5, '2025/26 income tax at $55,000');
eq(y25.acc, 918.5, '2025/26 ACC at 1.67%');
eq(y25.kiwiSaverEmployee, 1650, '2025/26 employee KiwiSaver 3%');
eq(y25.kiwiSaverEmployer, 1650, '2025/26 employer minimum 3%');
eq(y25.takeHome, 44231, '2025/26 take-home at $55,000');
eq(calcAcc(200000, payTaxYearRates(2025)), 2551.59, '2025/26 maximum ACC levy');
// Temporary rate reduction (KAN-88): 3% employee from 1 April 2026; the employer may match at 3% only then.
{
  const r26 = payTaxYearRates(2026);
  eq(r26.kiwiSaverEmployeeRates.includes(3), true, '2026/27 offers 3%');
  eq(r26.kiwiSaverDefaultEmployeeRate, 3.5, '2026/27 default stays 3.5%');
  eq(payTaxYearRates(2025).kiwiSaverEmployeeRates.join(), '3,4,6,8,10', '2025/26 rates unchanged');
  eq(payTaxYearRates(2025).kiwiSaverTemporaryReductionRate, null, '2025/26 has no temporary reduction');
  const matched = calculatePaye({ ...base, kiwiSaverEmployeeRatePct: 3, kiwiSaverEmployerRatePct: 3, studentLoan: false });
  eq(matched.kiwiSaverEmployee, 1650, 'employee 3% of $55,000');
  eq(matched.kiwiSaverEmployer, 1650, 'employer may match at 3%');
  eq(matched.notes.some((n) => n.includes('raised')), false, 'a 3% match is not raised');
  eq(calculatePaye({ ...base, kiwiSaverEmployeeRatePct: 3, studentLoan: false }).kiwiSaverEmployer, 1925, 'employer can stay at 3.5%');
  eq(calculatePaye({ ...base, kiwiSaverEmployeeRatePct: 3, kiwiSaverEmployerRatePct: 0, studentLoan: false }).kiwiSaverEmployer, 1650, 'blank employer rate falls back to 3% on a reduction');
  const notOnReduction = calculatePaye({ ...base, kiwiSaverEmployeeRatePct: 4, kiwiSaverEmployerRatePct: 3, studentLoan: false });
  eq(notOnReduction.kiwiSaverEmployer, 1925, 'employer 3% is lifted to 3.5% when the employee is not on 3%');
  eq(notOnReduction.notes.some((n) => n.includes('raised from 3% to the 3.5%')), true, 'and says so');
}
eq(calculatePaye({ ...base, taxYear: 2026, studentLoan: false }).takeHome, off.takeHome, 'taxYear 2026 matches the default');
eq(calculatePaye({ ...base, taxYear: 2031, studentLoan: false }).takeHome, off.takeHome, 'a year with no rates falls back to the current year');
eq(PAY_TAX_YEAR_OPTIONS.map((y) => y.startYear).join(), '2026,2025', 'years offered, newest first');
eq(taxYearForDate('2026-03-31'), 2025, '31 March is the end of the previous tax year');
eq(taxYearForDate('2026-04-01'), 2026, '1 April starts a new tax year');

console.log('payeCalc.test.ts ok');
