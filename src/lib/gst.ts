/**
 * GST returns (KAN-127): return periods, due dates and the GST101A boxes, on the payments
 * basis (sales when the money comes in, purchases when they're paid). Pure. An estimate to
 * check against myIR: the app never files anything.
 *
 * Periods: monthly, two-monthly or six-monthly. A business picks a month in which one of its
 * periods ends (IRD sets this when it registers: two-monthly periods end in odd or even months,
 * six-monthly ones in a chosen pair), and every period lines up with it.
 */
import { roundMoney } from './debtModel.ts';

export const GST_FREQUENCIES = [
  { value: 'monthly', label: 'Monthly', months: 1 },
  { value: 'two_monthly', label: 'Every 2 months', months: 2 },
  { value: 'six_monthly', label: 'Every 6 months', months: 6 },
] as const;
export type GstFrequency = (typeof GST_FREQUENCIES)[number]['value'];
export const isGstFrequency = (v: unknown): v is GstFrequency => GST_FREQUENCIES.some((f) => f.value === v);
const monthsIn = (f: GstFrequency) => GST_FREQUENCIES.find((x) => x.value === f)!.months;

/** How a tagged item counts for GST. Sales default to standard; expenses only count once marked. */
export const GST_TREATMENTS = ['standard', 'zero', 'exempt'] as const;
export type GstTreatment = (typeof GST_TREATMENTS)[number];
export const isGstTreatment = (v: unknown): v is GstTreatment => (GST_TREATMENTS as readonly unknown[]).includes(v);

export type GstSettings = { frequency: GstFrequency; periodEndMonth: number };
/** IRD's most common: two-monthly, periods ending in March (and May, July, …). */
export const DEFAULT_GST_SETTINGS: GstSettings = { frequency: 'two_monthly', periodEndMonth: 3 };

const pad = (n: number) => String(n).padStart(2, '0');
function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function addMonths(y: number, m: number, n: number): [number, number] {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
}

export type GstPeriod = { start: string; end: string };

/** The return period that contains `date`. */
export function periodContaining(date: string, s: GstSettings): GstPeriod {
  const len = monthsIn(s.frequency);
  const [y, m] = date.split('-').map(Number);
  // Months from the anchor month's end to this month, wrapped to the next period end at or after it.
  const offset = (((s.periodEndMonth - m) % len) + len) % len;
  const [ey, em] = addMonths(y, m, offset);
  const [sy, sm] = addMonths(ey, em, -(len - 1));
  return { start: `${sy}-${pad(sm)}-01`, end: `${ey}-${pad(em)}-${pad(lastDay(ey, em))}` };
}

export function shiftPeriod(p: GstPeriod, s: GstSettings, by: number): GstPeriod {
  const [y, m] = p.end.split('-').map(Number);
  const [ny, nm] = addMonths(y, m, by * monthsIn(s.frequency));
  return periodContaining(`${ny}-${pad(nm)}-01`, s);
}

/**
 * When the return and payment are due (IRD): the 28th of the month after the period ends,
 * except a period ending in November (15 January) or March (7 May).
 */
export function gstDueDate(periodEnd: string): string {
  const [y, m] = periodEnd.split('-').map(Number);
  if (m === 11) return `${y + 1}-01-15`;
  if (m === 3) return `${y}-05-07`;
  const [ny, nm] = addMonths(y, m, 1);
  return `${ny}-${pad(nm)}-28`;
}

/** The GST101A boxes. Amounts in boxes 5, 6, 7 and 11 include GST. */
export type Gst101a = {
  box5: number;
  box6: number;
  box7: number;
  box8: number;
  box9: number;
  box10: number;
  box11: number;
  box12: number;
  box13: number;
  box14: number;
  /** Box 10 − Box 14: positive is GST to pay, negative a refund. */
  box15: number;
};

const gstOf = (inclusive: number) => roundMoney((inclusive * 3) / 23);

/**
 * The return from period totals: all sales including GST and zero-rated sales (box 5), the
 * zero-rated part (box 6), and purchases including GST that you can claim (box 11). Adjustments
 * (boxes 9 and 13) aren't worked out here and default to 0.
 */
export function gst101a(t: { salesInclNzd: number; zeroRatedNzd: number; purchasesInclNzd: number; salesAdjustNzd?: number; purchaseAdjustNzd?: number }): Gst101a {
  const box5 = roundMoney(t.salesInclNzd);
  const box6 = roundMoney(t.zeroRatedNzd);
  const box7 = roundMoney(box5 - box6);
  const box8 = gstOf(box7);
  const box9 = roundMoney(t.salesAdjustNzd ?? 0);
  const box10 = roundMoney(box8 + box9);
  const box11 = roundMoney(t.purchasesInclNzd);
  const box12 = gstOf(box11);
  const box13 = roundMoney(t.purchaseAdjustNzd ?? 0);
  const box14 = roundMoney(box12 + box13);
  return { box5, box6, box7, box8, box9, box10, box11, box12, box13, box14, box15: roundMoney(box10 - box14) };
}

/** What each box is called on the GST101A, for the layout to copy into myIR. */
export const GST101A_BOXES: { box: keyof Gst101a; number: number; label: string }[] = [
  { box: 'box5', number: 5, label: 'Total sales and income for the period (including GST and any zero-rated supplies)' },
  { box: 'box6', number: 6, label: 'Zero-rated supplies included in Box 5' },
  { box: 'box7', number: 7, label: 'Subtract Box 6 from Box 5' },
  { box: 'box8', number: 8, label: 'Multiply Box 7 by 3 and divide by 23' },
  { box: 'box9', number: 9, label: 'Adjustments from your calculation sheet' },
  { box: 'box10', number: 10, label: 'Total GST collected on sales and income (Box 8 + Box 9)' },
  { box: 'box11', number: 11, label: 'Total purchases and expenses (including GST) for which tax invoicing requirements have been met' },
  { box: 'box12', number: 12, label: 'Multiply Box 11 by 3 and divide by 23' },
  { box: 'box13', number: 13, label: 'Credit adjustments from your calculation sheet' },
  { box: 'box14', number: 14, label: 'Total GST credit for purchases and expenses (Box 12 + Box 13)' },
  { box: 'box15', number: 15, label: 'Difference between Box 10 and Box 14' },
];
