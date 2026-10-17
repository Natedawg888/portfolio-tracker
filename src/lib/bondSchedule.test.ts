/**
 * Bonds and term deposits schedule (KAN-80). Figures worked by hand. Run: npm run test:bonds
 */
import { RWT_CHOICES, addMonths, bondSchedule, couponDates, maturityAlert, rwtChoiceLabel } from './bondSchedule.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

// Month arithmetic keeps the day, clamped to month end.
eq(addMonths('2026-08-31', -6), '2026-02-28', 'end of month clamps');
eq(addMonths('2026-02-28', 6, 31), '2026-08-31', 'and the original day returns');
eq(addMonths('2026-11-15', 3), '2027-02-15', 'across a year');

// NZ government bond: $10,000 face, 4.5% half-yearly, maturing 15 May 2029, bought 1 Oct 2026.
// Coupons 15 Nov 2026, 15 May 2027 … 15 May 2029 (6), each 10,000 × 4.5% ÷ 2 = $225; after 33% RWT $150.75.
const govt = { kind: 'govt' as const, faceValue: 10000, ratePct: 4.5, frequency: 'half_yearly' as const, purchaseDate: '2026-10-01', maturityDate: '2029-05-15', rwtPct: 33 };
let s = bondSchedule(govt);
const coupons = s.filter((p) => p.kind === 'coupon');
eq(coupons.length, 6, 'six coupons');
eq(coupons[0].date, '2026-11-15', 'first coupon');
eq(coupons[5].date, '2029-05-15', 'last on maturity');
eq(coupons[0].gross, 225, 'coupon gross');
eq(coupons[0].net, 150.75, 'after 33% RWT');
eq(s.at(-1)!.kind, 'principal', 'principal at the end');
eq(s.at(-1)!.net, 10000, 'face value back, no RWT');

// Term deposit, interest at maturity: $20,000 at 5% for 182 days → 20,000 × 0.05 × 182 ÷ 365 = $498.63.
const td = { kind: 'td' as const, faceValue: 20000, ratePct: 5, frequency: 'maturity' as const, purchaseDate: '2026-10-01', maturityDate: '2027-04-01', rwtPct: null };
s = bondSchedule(td);
eq(s.length, 2, 'one interest payment and the principal');
eq(s[0].date, '2027-04-01', 'interest at maturity');
eq(s[0].gross, 498.63, 'simple interest by days');
eq(s[0].net, 498.63, 'no RWT set: gross');

// Term deposit, monthly interest: daily accrual per month. Oct 1 → Nov 1 = 31 days: 20,000 × 5% × 31 ÷ 365 = $84.93.
s = bondSchedule({ ...td, frequency: 'monthly' });
eq(s[0].date, '2026-11-01', 'first monthly interest');
eq(s[0].gross, 84.93, '31 days');
eq(s[1].gross, 82.19, 'Nov 1 → Dec 1 is 30 days: $82.19');
eq(couponDates({ frequency: 'monthly', purchaseDate: '2026-10-01', maturityDate: '2027-04-01' }).length, 6, 'six months');

// Quarterly corporate bond bought just before a coupon date still gets it in full.
eq(bondSchedule({ ...govt, kind: 'corporate', frequency: 'quarterly', ratePct: 6, purchaseDate: '2026-11-14' })[0].gross, 150, '10,000 × 6% ÷ 4');

// Maturity alerts.
eq(maturityAlert('2026-10-20', '2026-10-16')?.level, '30', 'within 30 days');
eq(maturityAlert('2026-12-20', '2026-10-16')?.level, '90', 'within 90 days');
eq(maturityAlert('2027-06-01', '2026-10-16'), null, 'later');
eq(maturityAlert('2026-10-01', '2026-10-16')?.level, 'matured', 'already matured');

// RWT 28% (company) and 45% (no IRD number) (KAN-95): $10,000 at 10% yearly → $1,000 coupon.
{
  const yearly = { kind: 'corporate' as const, faceValue: 10000, ratePct: 10, frequency: 'yearly' as const, purchaseDate: '2026-10-01', maturityDate: '2027-06-30' };
  const at = (rwtPct: number) => bondSchedule({ ...yearly, rwtPct }).find((p) => p.kind === 'coupon')!;
  eq(at(45).gross, 1000, '$1,000 coupon');
  eq(at(45).net, 550, '45%: $450 RWT, $550 net');
  eq(at(28).net, 720, '28%: $280 RWT, $720 net');
  eq(at(33).net, 670, 'existing 33% unchanged');
  eq(RWT_CHOICES.join(), '10.5,17.5,28,30,33,39,45', 'RWT choices in order');
  eq(rwtChoiceLabel(28), '28% (company)', '28% label');
  eq(rwtChoiceLabel(45), '45% (no IRD number)', '45% label');
  eq(rwtChoiceLabel(10.5), '10.5%', 'individual rates keep the plain label');
}

console.log('bondSchedule.test.ts ok');
