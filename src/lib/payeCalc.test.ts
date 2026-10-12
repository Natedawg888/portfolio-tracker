/**
 * PAYE engine locks. Run: npm run test:paye
 * Figures come from calculatePaye / calcIetc / calcAcc. This file does not
 * change the engine; if a locked number moves, the test fails with both values.
 */
import { calcAcc, calcIetc, calculatePaye } from './payeCalc.ts';
import { defaultPayePrefs } from './payePrefs.ts';

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

console.log('payeCalc.test.ts ok');
