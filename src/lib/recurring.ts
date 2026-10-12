/**
 * Bills and subscriptions (KAN-26 / KAN-27): cadences, next-due dates, monthly
 * equivalents, payee matching and recurring detection from transactions.
 * Pure functions, shared by the API and the Bills & subscriptions page.
 */

export const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export type RecurringKind = 'bill' | 'subscription';
export type RecurringStatus = 'active' | 'paused' | 'cancelled';

/** Typical days between payments, and the window a real gap must fall in. */
const CADENCE_DAYS: Record<Cadence, { days: number; min: number; max: number }> = {
  weekly: { days: 7, min: 6, max: 8 },
  fortnightly: { days: 14, min: 12, max: 16 },
  monthly: { days: 30.44, min: 26, max: 35 },
  quarterly: { days: 91.3, min: 83, max: 99 },
  yearly: { days: 365.25, min: 340, max: 390 },
};

/** Per month: weekly × 52 ÷ 12, fortnightly × 26 ÷ 12, quarterly ÷ 3, yearly ÷ 12. */
export function monthlyEquivalent(amount: number, cadence: Cadence): number {
  const factor = { weekly: 52 / 12, fortnightly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[cadence];
  return Math.round(amount * factor * 100) / 100;
}

function parse(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `times` payment periods after `date`. Months keep the day, clamped to the month's last day. */
export function addCadence(date: string, cadence: Cadence, times = 1): string {
  const d = parse(date);
  if (cadence === 'weekly' || cadence === 'fortnightly') {
    d.setUTCDate(d.getUTCDate() + (cadence === 'weekly' ? 7 : 14) * times);
    return fmt(d);
  }
  const months = (cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12) * times;
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return fmt(target);
}

/** The first due date on or after `today`, stepping forward from a known due date. */
export function nextDueOnOrAfter(anchor: string, cadence: Cadence, today: string): string {
  let due = anchor;
  let step = 0;
  while (due < today && step < 5000) {
    step += 1;
    due = addCadence(anchor, cadence, step);
  }
  return due;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

/**
 * Due dates in the window that starts on `today` and stops before `withinDays`
 * (a date 30 days out is not included). Steps from `nextDue` itself, the same
 * walk listRecurring uses for "Due in the next 30 days". At most `maxSteps`
 * dates, so a weekly bill is counted each time it falls and then stops.
 * Callers pass active bills only; paused items stay out of the total.
 */
export function occurrencesWithin(
  nextDue: string,
  cadence: Cadence,
  today: string,
  withinDays = 30,
  maxSteps = 10,
): string[] {
  const dates: string[] = [];
  let due = nextDue;
  let step = 0;
  while (daysBetween(today, due) < withinDays && step < maxSteps) {
    dates.push(due);
    step += 1;
    due = addCadence(nextDue, cadence, step);
  }
  return dates;
}

const NOISE = [
  /\b(pos|eftpos|visa|debit|credit|card|purchase|payment|direct|dd|ap|ft|bp|tfr|transfer|online|recurring|autopay|nz|nzd|au|aus|us|usa|gb|uk|ie|sg|nl|ltd|limited|inc|co)\b/g,
  /\b\d{2}[/.-]\d{2}([/.-]\d{2,4})?\b/g, // dates
  /\b[a-z]*\d[a-z\d]*\b/g, // card numbers, references, store ids
  /[^a-z\s]/g,
];

/**
 * Stable key for "the same payee": lowercase, without card / reference noise.
 * "NETFLIX.COM 4029357733 AU" and "Netflix.com" both become "netflix com".
 */
export function merchantKey(text: string): string {
  let s = ` ${text.toLowerCase()} `;
  for (const re of NOISE) s = s.replace(re, ' ');
  // One-letter fragments ("w d" from "W/D") are noise too.
  return s
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 4)
    .join(' ');
}

export type DetectionTxn = {
  id: string;
  date: string;
  /** Negative = money out. */
  amount: number;
  description: string;
  merchant: string | null;
  categoryId: string | null;
  categoryName: string | null;
};

export type RecurringSuggestion = {
  merchantKey: string;
  name: string;
  kind: RecurringKind;
  cadence: Cadence;
  /** Typical amount (median of the last three payments), NZD. */
  amountNzd: number;
  monthlyNzd: number;
  lastDate: string;
  nextDue: string;
  occurrences: number;
  /** 0–1: share of gaps that match the cadence, less a penalty for varying amounts. */
  confidence: number;
  amountVaries: boolean;
  categoryId: string | null;
  categoryName: string | null;
  transactionIds: string[];
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A readable name: the merchant if there is one, else the cleaned description. */
function displayName(txns: DetectionTxn[], key: string): string {
  const latest = txns[txns.length - 1];
  const raw = (latest.merchant || '').trim();
  if (raw) return raw.slice(0, 80);
  return titleCase(key).slice(0, 80) || latest.description.slice(0, 80);
}

/**
 * Recurring payments in the user's spending. A payee needs at least three payments
 * (two for yearly) whose gaps mostly match one cadence. Payments that stopped (no
 * payment for more than two periods) are left out, so cancelled services don't come back.
 */
export function detectRecurring(txns: DetectionTxn[], today: string): RecurringSuggestion[] {
  const groups = new Map<string, DetectionTxn[]>();
  for (const t of txns) {
    if (!(t.amount < 0)) continue;
    const key = merchantKey(t.merchant || t.description);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const out: RecurringSuggestion[] = [];
  for (const [key, raw] of groups) {
    const list = [...raw].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // Several payments on one day count once, with their total.
    const byDay = new Map<string, DetectionTxn[]>();
    for (const t of list) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
    const days = [...byDay.keys()];
    if (days.length < 2) continue;
    const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
    const typical = median(gaps);
    const cadence = (Object.keys(CADENCE_DAYS) as Cadence[]).find(
      (c) => typical >= CADENCE_DAYS[c].min && typical <= CADENCE_DAYS[c].max,
    );
    if (!cadence) continue;
    if (days.length < (cadence === 'yearly' ? 2 : 3)) continue;
    const range = CADENCE_DAYS[cadence];
    const gapShare = gaps.filter((g) => g >= range.min && g <= range.max).length / gaps.length;
    if (gapShare < 0.6) continue;

    const amounts = days.map((d) => Math.abs(byDay.get(d)!.reduce((s, t) => s + t.amount, 0)));
    const recent = amounts.slice(-3);
    const amount = Math.round(median(recent) * 100) / 100;
    const variation = amount > 0 ? (Math.max(...recent) - Math.min(...recent)) / amount : 1;
    if (variation > 0.6) continue; // too irregular to call a bill
    const lastDate = days[days.length - 1];
    if (daysBetween(lastDate, today) > range.days * 2 + 7) continue; // stopped

    const latest = list[list.length - 1];
    const categoryName = latest.categoryName;
    const subscriptionCategory = /subscri|stream|software|membership/i.test(categoryName ?? '');
    const billCategory = /utilit|housing|insur|phone|power|internet|rent/i.test(categoryName ?? '');
    // A steady small charge with no other category looks like a subscription; anything
    // filed under another spending category (food, transport …) stays a bill.
    const otherCategory = Boolean(categoryName) && !subscriptionCategory && !billCategory;
    const kind: RecurringKind = subscriptionCategory
      ? 'subscription'
      : billCategory || otherCategory
        ? 'bill'
        : variation <= 0.03 && cadence !== 'quarterly' && amount <= 200
          ? 'subscription'
          : 'bill';

    out.push({
      merchantKey: key,
      name: displayName(list, key),
      kind,
      cadence,
      amountNzd: amount,
      monthlyNzd: monthlyEquivalent(amount, cadence),
      lastDate,
      nextDue: nextDueOnOrAfter(addCadence(lastDate, cadence), cadence, today),
      occurrences: days.length,
      confidence: Math.round(Math.max(0, gapShare - Math.min(0.3, variation)) * 100) / 100,
      amountVaries: variation > 0.03,
      categoryId: latest.categoryId,
      categoryName,
      transactionIds: list.map((t) => t.id),
    });
  }
  return out.sort((a, b) => b.monthlyNzd - a.monthlyNzd || a.name.localeCompare(b.name));
}
