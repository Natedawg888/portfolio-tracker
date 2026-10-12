/**
 * Recurring detection and due dates (KAN-26). Run: npm run test:bills
 */
import {
  addCadence,
  detectRecurring,
  merchantKey,
  monthlyEquivalent,
  nextDueOnOrAfter,
  occurrencesWithin,
  possibleSubscriptions,
  type DetectionTxn,
} from './recurring.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

let n = 0;
const txn = (date: string, amount: number, description: string, extra: Partial<DetectionTxn> = {}): DetectionTxn => ({
  id: `t${++n}`,
  date,
  amount,
  description,
  merchant: null,
  categoryId: null,
  categoryName: null,
  ...extra,
});

// Dates.
eq(addCadence('2026-01-31', 'monthly'), '2026-02-28', 'month end clamps');
eq(addCadence('2026-01-31', 'monthly', 2), '2026-03-31', 'and comes back to the 31st');
eq(addCadence('2026-10-08', 'fortnightly'), '2026-10-22', 'fortnight');
eq(addCadence('2024-02-29', 'yearly'), '2025-02-28', 'leap day yearly');
eq(nextDueOnOrAfter('2026-07-15', 'monthly', '2026-10-09'), '2026-10-15', 'rolls forward to the next due date');
eq(nextDueOnOrAfter('2026-10-15', 'monthly', '2026-10-09'), '2026-10-15', 'future due date unchanged');
eq(monthlyEquivalent(10, 'weekly'), 43.33, 'weekly × 52 / 12');
eq(monthlyEquivalent(120, 'yearly'), 10, 'yearly / 12');

// Totals the Bills summary shows for a weekly 270 and a monthly 40. Fixed dates,
// not "today". Per year is the monthly sum × 12. Due in 30 days counts every
// occurrence (day 30 itself is outside the window).
{
  const rentMonth = monthlyEquivalent(270, 'weekly');
  const sparkMonth = monthlyEquivalent(40, 'monthly');
  eq(rentMonth, 1170, 'weekly 270 × 52 / 12');
  eq(sparkMonth, 40, 'monthly 40 is unchanged');
  const perMonth = rentMonth + sparkMonth;
  eq(perMonth, 1210, 'per month');
  eq(perMonth * 12, 14520, 'per year is per month × 12');

  const today = '2026-10-12';
  const rentDue = occurrencesWithin('2026-10-14', 'weekly', today);
  const sparkDue = occurrencesWithin('2026-10-20', 'monthly', today);
  eq(rentDue.join(','), '2026-10-14,2026-10-21,2026-10-28,2026-11-04', 'weekly rent four times');
  eq(sparkDue.join(','), '2026-10-20', 'monthly spark once');
  eq(rentDue.length * 270 + sparkDue.length * 40, 1120, 'due in the next 30 days');
  eq(occurrencesWithin('2026-10-12', 'weekly', today).length, 5, 'weekly from today counts five');
  eq(occurrencesWithin('2026-11-11', 'weekly', today).length, 0, 'a date 30 days out is not due');
  eq(occurrencesWithin('2026-01-01', 'weekly', '2026-01-01', 365).length, 10, 'the walk stops after 10 dates');
}

// Payee matching ignores card numbers, references and punctuation.
eq(merchantKey('NETFLIX.COM 4029357733 AU'), merchantKey('Netflix.com'), 'same payee key');
eq(merchantKey('POS W/D SPARK NZ 1234'), merchantKey('Spark NZ'), 'POS prefix dropped');

const today = '2026-10-09';
const txns: DetectionTxn[] = [
  // Monthly subscription, same amount.
  txn('2026-06-12', -22.99, 'NETFLIX.COM 4029357733'),
  txn('2026-07-12', -22.99, 'NETFLIX.COM 4029357733'),
  txn('2026-08-12', -22.99, 'NETFLIX.COM 4029357733'),
  txn('2026-09-12', -22.99, 'NETFLIX.COM 4029357733'),
  // Monthly power bill that varies.
  txn('2026-07-03', -180.4, 'Contact Energy DD', { categoryName: 'Utilities', categoryId: 'cat-utilities' }),
  txn('2026-08-03', -210.1, 'Contact Energy DD', { categoryName: 'Utilities', categoryId: 'cat-utilities' }),
  txn('2026-09-02', -165.75, 'Contact Energy DD', { categoryName: 'Utilities', categoryId: 'cat-utilities' }),
  // Weekly.
  txn('2026-09-15', -15, 'Gym Weekly'),
  txn('2026-09-22', -15, 'Gym Weekly'),
  txn('2026-09-29', -15, 'Gym Weekly'),
  txn('2026-10-06', -15, 'Gym Weekly'),
  // Yearly (two payments is enough).
  txn('2025-10-20', -99, 'Domain renewal'),
  txn('2026-10-01', -99, 'Domain renewal'),
  // Irregular groceries: not recurring.
  txn('2026-09-01', -80, 'Countdown'),
  txn('2026-09-04', -120, 'Countdown'),
  txn('2026-09-19', -45, 'Countdown'),
  txn('2026-10-02', -150, 'Countdown'),
  // Stopped: last paid in May.
  txn('2026-03-05', -12, 'Old streaming'),
  txn('2026-04-05', -12, 'Old streaming'),
  txn('2026-05-05', -12, 'Old streaming'),
  // Money in is never a bill.
  txn('2026-07-20', 3000, 'Salary'),
  txn('2026-08-20', 3000, 'Salary'),
  txn('2026-09-20', 3000, 'Salary'),
];
const found = detectRecurring(txns, today);
const by = Object.fromEntries(found.map((s) => [s.name.toLowerCase(), s]));

const netflix = found.find((s) => s.merchantKey === merchantKey('NETFLIX.COM'));
assert(netflix, 'Netflix detected');
eq(netflix!.cadence, 'monthly', 'Netflix monthly');
eq(netflix!.kind, 'subscription', 'same amount → subscription');
eq(netflix!.amountNzd, 22.99, 'Netflix amount');
eq(netflix!.nextDue, '2026-10-12', 'Netflix next due');
eq(netflix!.occurrences, 4, 'four payments');
assert(netflix!.confidence >= 0.9, 'high confidence');

const power = found.find((s) => s.merchantKey === merchantKey('Contact Energy DD'));
assert(power, 'varying power bill detected');
eq(power!.kind, 'bill', 'utilities category → bill');
eq(power!.amountNzd, 180.4, 'median of the last three');
assert(power!.amountVaries, 'flagged as varying');

eq(by['gym weekly']?.cadence, 'weekly', 'weekly gym');
eq(by['gym weekly']?.nextDue, '2026-10-13', 'weekly next due');
eq(by['domain renewal']?.cadence, 'yearly', 'yearly with two payments');
assert(!found.some((s) => s.merchantKey === merchantKey('Countdown')), 'irregular groceries are not recurring');
assert(!found.some((s) => s.merchantKey === merchantKey('Old streaming')), 'stopped payments are left out');
assert(!found.some((s) => s.merchantKey === merchantKey('Salary')), 'income is not a bill');
assert(found[0].monthlyNzd >= found[found.length - 1].monthlyNzd, 'largest monthly cost first');

// Kind: other spending categories and large fixed amounts are bills, not subscriptions.
{
  const fixed = (desc: string, amount: number, categoryName: string | null) =>
    [1, 2, 3, 4].map((m) => txn(`2026-0${5 + m}-11`, amount, desc, { categoryName }));
  const kinds = detectRecurring(
    [...fixed('Groceries order', -3500, 'Food & groceries'), ...fixed('Mortgage', -2400, null), ...fixed('Disney Plus', -18.99, null)],
    today,
  );
  const kindOf = (d: string) => kinds.find((k) => k.merchantKey === merchantKey(d))?.kind;
  eq(kindOf('Groceries order'), 'bill', 'food category → bill');
  eq(kindOf('Mortgage'), 'bill', 'large fixed payment → bill');
  eq(kindOf('Disney Plus'), 'subscription', 'small fixed payment with no category → subscription');
}

// Account of the latest payment, and the regular tier.
{
  const acct = detectRecurring(
    [1, 2, 3].map((m) => txn(`2026-0${6 + m}-05`, -9.99, 'Tidal', { accountName: m === 3 ? 'Everyday' : 'Old card' })),
    today,
  );
  eq(acct[0].accountName, 'Everyday', 'latest payment account');
  eq(acct[0].tier, 'regular', 'repeat-payment rule is the regular tier');
}

// Lower-confidence tier: Subscriptions-category payees seen once or twice, paid recently.
{
  const subs = { categoryName: 'Subscriptions', categoryId: 'cat-subs', accountName: 'Everyday' };
  const txns = [
    txn('2026-10-01', -58.08, 'ADOBE *CREATIVE CLD', subs),
    txn('2026-08-20', -10, 'Canva', subs),
    txn('2026-09-20', -12, 'Canva', subs),
    txn('2026-08-01', -5, 'Old one-off app', subs), // more than 35 days ago
    txn('2026-10-02', -40, 'Pizza place', { categoryName: 'Eating out' }), // not Subscriptions
    ...[7, 8, 9].map((m) => txn(`2026-0${m}-03`, -14.99, 'Spotify', subs)), // three payments: regular rule decides
    txn('2026-10-03', -20, 'Already regular', subs),
  ];
  const maybe = possibleSubscriptions(txns, today, new Set([merchantKey('Already regular')]));
  const keys = maybe.map((s) => s.merchantKey);
  eq(keys.join(','), [merchantKey('ADOBE *CREATIVE CLD'), merchantKey('Canva')].join(','), 'Adobe and Canva only, newest first');
  const adobe = maybe[0];
  eq(adobe.tier, 'possible', 'possible tier');
  eq(adobe.amountNzd, 58.08, 'amount of the payment');
  eq(adobe.occurrences, 1, 'seen once');
  eq(adobe.lastDate, '2026-10-01', 'date of the payment');
  eq(adobe.nextDue, '2026-11-01', 'monthly assumed for next due');
  eq(adobe.accountName, 'Everyday', 'account');
  eq(adobe.kind, 'subscription', 'subscription');
  eq(adobe.amountVaries, false, 'one payment does not vary');
  const canva = maybe[1];
  eq(canva.occurrences, 2, 'Canva seen twice');
  eq(canva.amountNzd, 12, 'latest amount');
  eq(canva.amountVaries, true, '10 then 12 varies');
}

console.log('recurring detection tests ok');
