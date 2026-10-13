/**
 * Bills header counts (phase 1), calendar strip and "Coming up" (phase 2). Run: npm run test:bills
 */
import { occurrencesWithin } from '../lib/recurring.ts';
import {
  billColours,
  billInitial,
  billsSubtitle,
  cadenceLine,
  creditorFor,
  dueInfo,
  monthlyNote,
  orderBills,
  possiblePaymentText,
  calendarDays,
  dayAriaLabel,
  dismissLabel,
  headerCounts,
  paidDate,
  suggestionFacts,
  suggestionTitle,
  relativeDay,
  upcomingOccurrences,
} from './billsView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const counts = headerCounts([
  { status: 'active' },
  { status: 'active' },
  { status: 'paused' },
  { status: 'cancelled' },
  { status: 'other' },
]);
eq(counts.active, 2, 'active');
eq(counts.paused, 1, 'paused stays separate from cancelled');
eq(counts.cancelled, 1, 'cancelled is not folded into paused');
eq(billsSubtitle(counts), '2 active · 1 paused · found in your transactions or added by you', 'subtitle');
eq(billsSubtitle(headerCounts([])), '0 active · 0 paused · found in your transactions or added by you', 'empty list');


type Bill = Parameters<typeof upcomingOccurrences>[0][number];
const today = '2026-10-13';
const money = (n: number) => `$${n.toFixed(2)}`;
const sum = (xs: ReadonlyArray<{ amountNzd: number }>) => Math.round(xs.reduce((s, o) => s + o.amountNzd, 0) * 100) / 100;
/** The server's dueNext30DaysNzd, computed the way listRecurring does it. */
const serverTotal = (bills: Bill[]) =>
  Math.round(bills.filter((b) => b.status === 'active').reduce((s, b) => s + b.amountNzd * occurrencesWithin(b.nextDue, b.cadence, today).length, 0) * 100) / 100;

const rent: Bill = { id: 'r', name: 'Rent', amountNzd: 270, cadence: 'weekly', nextDue: '2026-10-15', status: 'active' };
const spark: Bill = { id: 's', name: 'Spark', amountNzd: 40, cadence: 'monthly', nextDue: '2026-10-20', status: 'active' };
const gym: Bill = { id: 'g', name: 'Gym', amountNzd: 25, cadence: 'weekly', nextDue: '2026-10-14', status: 'paused' };

const occ = upcomingOccurrences([spark, gym, rent], today);
eq(sum(occ), 1120, 'weekly $270 Rent (2 days away) + monthly $40 Spark = $1,120.00');
eq(sum(occ), serverTotal([spark, gym, rent]), 'occurrences add up to the server-style total');
eq(occ.filter((o) => o.itemId === 'r').length, 4, 'Rent falls four times');
eq(occ.some((o) => o.itemId === 'g'), false, 'a paused bill contributes nothing');
eq(occ.map((o) => o.date).join(','), '2026-10-15,2026-10-20,2026-10-22,2026-10-29,2026-11-05', 'sorted by date');
eq(occ[0].daysAway, 2, 'days away');
eq(occ[0].colourIndex !== occ[1].colourIndex, true, 'each bill has its own colour');
eq(occ.filter((o) => o.itemId === 'r').every((o) => o.colourIndex === occ[0].colourIndex), true, 'a bill keeps one colour');

const rentToday = { ...rent, nextDue: today };
const occToday = upcomingOccurrences([rentToday, spark, gym], today);
eq(occToday.filter((o) => o.itemId === 'r').length, 5, 'Rent due today falls five times');
eq(sum(occToday), 1390, 'Rent due today + Spark = $1,390.00');
eq(sum(occToday), serverTotal([rentToday, spark, gym]), 'matches the server-style total with Rent due today');

const edge = upcomingOccurrences(
  [
    { id: 'a', name: 'Day 29', amountNzd: 10, cadence: 'yearly', nextDue: '2026-11-11', status: 'active' },
    { id: 'b', name: 'Day 30', amountNzd: 10, cadence: 'yearly', nextDue: '2026-11-12', status: 'active' },
    { id: 'c', name: 'Cancelled', amountNzd: 10, cadence: 'weekly', nextDue: today, status: 'cancelled' },
  ],
  today,
);
eq(edge.map((o) => o.name).join(','), 'Day 29', 'window is today through day 29; cancelled drops out');

const sameDay = upcomingOccurrences(
  [
    { id: 'z', name: 'Zoo', amountNzd: 1, cadence: 'monthly', nextDue: '2026-10-15', status: 'active' },
    { id: 'y', name: 'Apple', amountNzd: 2, cadence: 'monthly', nextDue: '2026-10-15', status: 'active' },
  ],
  today,
);
eq(sameDay.map((o) => o.name).join(','), 'Apple,Zoo', 'same date sorts by name');

const days = calendarDays(today, occ);
eq(days.length, 30, 'thirty days');
eq(days[0].date, today, 'starts today');
eq(days[0].isToday && !days[1].isToday, true, 'only the first day is today');
eq(days[29].date, '2026-11-11', 'ends on day 29');
eq(`${days[0].weekday} ${days[0].dayOfMonth} ${days[0].month}`, 'Tue 13 Oct', 'weekday, date and month');
eq(sum(days.flatMap((d) => d.items)), 1120, 'every occurrence lands on a day in the strip');
eq(dayAriaLabel(days[2], money), 'Thu 15 Oct: Rent $270.00', 'label lists what is due');
eq(dayAriaLabel(days[3], money), 'Fri 16 Oct: nothing due', 'label for an empty day');
eq(dayAriaLabel(calendarDays(today, sameDay)[2], money), 'Thu 15 Oct: Apple $2.00, Zoo $1.00', 'label lists several bills');

eq(relativeDay(0), 'today', 'today');
eq(relativeDay(1), 'tomorrow', 'tomorrow');
eq(relativeDay(9), 'in 9 days', 'in N days');

// Suggestion cards (phase 3).
const adobe = { name: 'Adobe', kind: 'subscription', tier: 'possible', cadence: 'monthly', lastDate: '2026-10-10', occurrences: 1, amountVaries: false, accountName: 'Everyday' } as const;
const power = { name: 'Contact Energy', kind: 'bill', tier: 'regular', cadence: 'monthly', lastDate: '2025-12-28', occurrences: 4, amountVaries: true, accountName: null } as const;
eq(suggestionTitle(adobe), 'Is Adobe a subscription?', 'subscription title');
eq(suggestionTitle(power), 'Is Contact Energy a regular bill?', 'bill title');
eq(dismissLabel(adobe), 'Not a subscription', 'dismiss label for a subscription');
eq(dismissLabel(power), 'Not a bill', 'dismiss label for a bill');
eq(paidDate('2026-10-10', today), '10 Oct', 'this year has no year');
eq(paidDate('2025-12-28', today), '28 Dec 2025', 'another year shows it');
eq(suggestionFacts(adobe, today).join(' · '), 'Everyday · Paid 10 Oct · seen once', 'possible tier facts, no frequency');
eq(suggestionFacts(power, today).join(' · '), 'Last paid 28 Dec 2025 · seen 4 times · monthly · amount varies', 'regular tier facts, no account');
eq(suggestionFacts({ ...adobe, occurrences: 2 }, today).join(' · '), 'Everyday · Last paid 10 Oct · seen twice', 'seen twice');

// Bill cards (phase 4).
const colours = billColours([spark, gym, rent]);
eq(colours.get('r'), 0, 'Rent first by name');
eq(colours.get('s'), 1, 'Spark second');
eq(colours.has('g'), false, 'paused bill has no colour');
eq(colours.get('r'), occ.find((o) => o.itemId === 'r')!.colourIndex, 'card and calendar share the colour');
eq(orderBills([spark, gym, rent]).map((b) => b.id).join(','), 'r,s,g', 'active by next due, paused last');
eq(billInitial('rent'), 'R', 'initial');
eq(billInitial('  2degrees'), '2', 'digit initial');
eq(billInitial('***'), '?', 'no letters');
eq(cadenceLine({ cadence: 'weekly', categoryName: 'Housing' }), 'Weekly · Housing', 'cadence and category');
eq(cadenceLine({ cadence: 'monthly', categoryName: null }), 'Monthly', 'no category');
eq(monthlyNote({ cadence: 'weekly', monthlyNzd: 1170 }, money), '$1170.00 a month', 'weekly shows a monthly figure');
eq(monthlyNote({ cadence: 'monthly', monthlyNzd: 40 }, money), null, 'monthly does not');
eq(dueInfo(rent, today)?.daysAway, 2, 'Rent in 2 days');
eq(dueInfo(rent, today)?.soon, true, '2 days is due soon');
eq(dueInfo({ ...rent, nextDue: '2026-10-16' }, today)?.soon, true, '3 days is due soon');
eq(dueInfo({ ...rent, nextDue: '2026-10-17' }, today)?.soon, false, '4 days is not');
eq(dueInfo(gym, today), null, 'paused bill has no due date');
const pay = { transactionId: 't', date: '2026-10-10', amountNzd: 270, payee: 'TFR TO J LANDLORD', categoryName: 'Housing' };
eq(possiblePaymentText(pay, today, money), 'A $270.00 Housing payment on 10 Oct looks like this bill', 'with category');
eq(possiblePaymentText({ ...pay, categoryName: null }, today, money), 'A $270.00 payment to TFR TO J LANDLORD on 10 Oct looks like this bill', 'with payee');
const debts = [{ name: 'Mum', outstandingNzd: 500 }, { name: 'Spark NZ', outstandingNzd: 113.29 }, { name: 'Gym Co', outstandingNzd: 0 }];
eq(creditorFor('Spark', debts)?.outstandingNzd, 113.29, 'Spark matches Spark NZ');
eq(creditorFor('Spark Broadband', debts)?.name, 'Spark NZ', 'longer bill name matches');
eq(creditorFor('Sparkle', debts), null, 'not a prefix of a word');
eq(creditorFor('Gym', debts), null, 'paid-off debt is not mentioned');
eq(creditorFor('Rent', debts), null, 'no creditor');

console.log('bills view tests ok');
