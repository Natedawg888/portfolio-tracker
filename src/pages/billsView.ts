/**
 * Bills page view helpers. Header counts (phase 1), the 30-day calendar strip
 * and "Coming up" list (phase 2), suggestion card text (phase 3), and bill cards (phase 4). The summary totals stay on the list response;
 * occurrences use the same occurrencesWithin walk as the server, so they add up to
 * dueNext30DaysNzd.
 */
import { CADENCE_LABELS, daysBetween, merchantKey, occurrencesWithin, type Cadence, type PossiblePayment } from '../lib/recurring';

export type HeaderCounts = { active: number; paused: number; cancelled: number };

/** Active, paused, and cancelled counted apart. Any other status is ignored. */
export function headerCounts(items: ReadonlyArray<{ status: string }>): HeaderCounts {
  const counts: HeaderCounts = { active: 0, paused: 0, cancelled: 0 };
  for (const item of items) {
    if (item.status === 'active') counts.active += 1;
    else if (item.status === 'paused') counts.paused += 1;
    else if (item.status === 'cancelled') counts.cancelled += 1;
  }
  return counts;
}

/** "[N] active · [M] paused · found in your transactions or added by you". */
export function billsSubtitle(counts: Pick<HeaderCounts, 'active' | 'paused'>): string {
  return `${counts.active} active · ${counts.paused} paused · found in your transactions or added by you`;
}

type BillLike = { id: string; name: string; amountNzd: number; cadence: Cadence; nextDue: string; status: string };

/** One payment of one bill on one date in the window. */
export type Occurrence = {
  date: string;
  itemId: string;
  name: string;
  amountNzd: number;
  /** The bill's position among active bills sorted by name, so each bill keeps one colour. */
  colourIndex: number;
  daysAway: number;
};

export type CalendarDay = {
  date: string;
  weekday: string;
  dayOfMonth: number;
  month: string;
  isToday: boolean;
  items: Occurrence[];
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

function addDays(ymd: string, n: number): string {
  const d = utc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Wed 15 Oct". */
export function shortDate(ymd: string): string {
  const d = utc(ymd);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Colour index per active bill: its position among active bills sorted by name. Others get none. */
export function billColours(items: ReadonlyArray<{ id: string; name: string; status: string }>): Map<string, number> {
  const active = items
    .filter((i) => i.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(active.map((i, index) => [i.id, index]));
}

/** Every payment of every active bill from `today` through day `days - 1`, by date then name. */
export function upcomingOccurrences(items: ReadonlyArray<BillLike>, today: string, days = 30): Occurrence[] {
  const colours = billColours(items);
  const out: Occurrence[] = [];
  for (const item of items) {
    const colourIndex = colours.get(item.id);
    if (colourIndex == null) continue;
    for (const date of occurrencesWithin(item.nextDue, item.cadence, today, days)) {
      out.push({ date, itemId: item.id, name: item.name, amountNzd: item.amountNzd, colourIndex, daysAway: daysBetween(today, date) });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
}

/** One entry per day from `today`, each holding the occurrences due that day. */
export function calendarDays(today: string, occurrences: ReadonlyArray<Occurrence>, days = 30): CalendarDay[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    const d = utc(date);
    return {
      date,
      weekday: WEEKDAYS[d.getUTCDay()],
      dayOfMonth: d.getUTCDate(),
      month: MONTHS[d.getUTCMonth()],
      isToday: i === 0,
      items: occurrences.filter((o) => o.date === date),
    };
  });
}

/** "Wed 15 Oct: Rent $270.00, Spark $40.00" or "Thu 16 Oct: nothing due". */
export function dayAriaLabel(day: CalendarDay, money: (n: number) => string): string {
  const due = day.items.map((o) => `${o.name} ${money(o.amountNzd)}`).join(', ');
  return `${shortDate(day.date)}: ${due || 'nothing due'}`;
}

/** "today", "tomorrow", "in N days". */
export function relativeDay(daysAway: number): string {
  if (daysAway === 0) return 'today';
  if (daysAway === 1) return 'tomorrow';
  return `in ${daysAway} days`;
}

type SuggestionLike = {
  name: string;
  kind: 'bill' | 'subscription';
  tier: 'regular' | 'possible';
  cadence: Cadence;
  lastDate: string;
  occurrences: number;
  amountVaries: boolean;
  accountName: string | null;
};

/** "Is Netflix a subscription?" or "Is Contact Energy a regular bill?". */
export function suggestionTitle(s: Pick<SuggestionLike, 'name' | 'kind'>): string {
  return `Is ${s.name} a ${s.kind === 'subscription' ? 'subscription' : 'regular bill'}?`;
}

export function dismissLabel(s: Pick<SuggestionLike, 'kind'>): string {
  return s.kind === 'subscription' ? 'Not a subscription' : 'Not a bill';
}

/** "10 Oct", with the year when it is not this year. */
export function paidDate(ymd: string, today: string): string {
  const d = utc(ymd);
  const year = ymd.slice(0, 4) === today.slice(0, 4) ? '' : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
}

/** The facts under the title: account, date, times seen, and frequency for the regular tier. */
export function suggestionFacts(s: SuggestionLike, today: string): string[] {
  const seen = s.occurrences === 1 ? 'seen once' : s.occurrences === 2 ? 'seen twice' : `seen ${s.occurrences} times`;
  const facts = [
    s.accountName,
    `${s.occurrences === 1 ? 'Paid' : 'Last paid'} ${paidDate(s.lastDate, today)}`,
    seen,
    s.tier === 'regular' ? CADENCE_LABELS[s.cadence].toLowerCase() : null,
    s.amountVaries ? 'amount varies' : null,
  ];
  return facts.filter((f): f is string => Boolean(f));
}

type CardBill = BillLike & { categoryName: string | null; monthlyNzd: number };

/** Active bills by next due date, then paused and cancelled by name. */
export function orderBills<T extends BillLike>(items: ReadonlyArray<T>): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);
  const active = items.filter((i) => i.status === 'active').sort((a, b) => (a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : byName(a, b)));
  return [...active, ...items.filter((i) => i.status !== 'active').sort(byName)];
}

export function billInitial(name: string): string {
  return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
}

/** "Weekly · Housing", or just "Weekly". */
export function cadenceLine(b: Pick<CardBill, 'cadence' | 'categoryName'>): string {
  return [CADENCE_LABELS[b.cadence], b.categoryName].filter(Boolean).join(' · ');
}

/** "$1,170.00 a month" for bills that are not monthly. */
export function monthlyNote(b: Pick<CardBill, 'cadence' | 'monthlyNzd'>, money: (n: number) => string): string | null {
  return b.cadence === 'monthly' ? null : `${money(b.monthlyNzd)} a month`;
}

/** Days until the active bill's next due date, and whether it is due soon (3 days or less). */
export function dueInfo(b: Pick<CardBill, 'nextDue' | 'status'>, today: string): { date: string; daysAway: number; soon: boolean } | null {
  if (b.status !== 'active') return null;
  const daysAway = daysBetween(today, b.nextDue);
  return { date: shortDate(b.nextDue), daysAway, soon: daysAway <= 3 };
}

/** "A $270.00 Housing payment on 10 Oct looks like this bill". */
export function possiblePaymentText(p: PossiblePayment, today: string, money: (n: number) => string): string {
  const what = p.categoryName ? `${p.categoryName} payment` : `payment to ${p.payee}`;
  return `A ${money(p.amountNzd)} ${what} on ${paidDate(p.date, today)} looks like this bill`;
}

/**
 * A creditor on Debts with the same name as the bill ("Spark" and "Spark NZ" match:
 * the same merchantKey, or one name's words start the other's). Only debts still owing.
 */
export function creditorFor<D extends { name: string; outstandingNzd: number }>(billName: string, debts: ReadonlyArray<D>): D | null {
  const bill = merchantKey(billName);
  if (!bill) return null;
  const starts = (a: string, b: string) => a === b || a.startsWith(`${b} `);
  return debts.find((d) => {
    const key = merchantKey(d.name);
    return d.outstandingNzd > 0 && Boolean(key) && (starts(bill, key) || starts(key, bill));
  }) ?? null;
}
