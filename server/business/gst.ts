/**
 * GST return for one business and period (KAN-127), payments basis, built on businessMoney so
 * each dollar counts once (as in the P&L):
 *   sales      invoice payments (standard when the invoice charged GST, zero-rated when it
 *              didn't; change it on the invoice), tagged income and tagged deposits (standard
 *              unless marked zero-rated or no GST)
 *   purchases  tagged bank debits, claimed only once marked GST-inclusive (a claim needs a
 *              tax invoice); transfers are neither
 * The boxes follow the GST101A. Adjustments (boxes 9 and 13) aren't worked out. An estimate
 * to check against myIR; nothing is filed.
 */
import type { Database } from 'sql.js';
import { DEFAULT_GST_SETTINGS, gst101a, gstDueDate, isGstFrequency, isGstTreatment, periodContaining, type Gst101a, type GstPeriod, type GstSettings, type GstTreatment } from '../../src/lib/gst.ts';
import { roundMoney } from '../../src/lib/debtModel.ts';
import { queryAll, queryOne, run } from '../db/index.ts';
import { businessMoney } from './store.ts';

export type GstItem = {
  kind: 'invoice_payment' | 'income' | 'transaction' | 'sale';
  id: string;
  date: string;
  description: string;
  /** Always positive; `side` says which way the money went. */
  amountNzd: number;
  side: 'sale' | 'purchase';
  treatment: GstTreatment;
  /** False when the treatment is the default (sales standard, purchases not claimed). */
  marked: boolean;
  /** Invoice payments follow their invoice and can't be changed here. */
  editable: boolean;
  /** GST content: 3/23 of a standard-rated amount, else 0. */
  gstNzd: number;
};

export type GstReturnView = {
  registered: boolean;
  settings: GstSettings;
  period: GstPeriod;
  dueDate: string;
  boxes: Gst101a;
  items: GstItem[];
};

export function gstSettingsOf(db: Database, userId: string, businessId: string): GstSettings {
  const r = queryOne<{ f: string | null; m: number | null }>(db, `SELECT gst_frequency AS f, gst_period_end_month AS m FROM businesses WHERE id = ? AND user_id = ?`, [businessId, userId]);
  const month = Number(r?.m);
  return {
    frequency: isGstFrequency(r?.f) ? r!.f : DEFAULT_GST_SETTINGS.frequency,
    periodEndMonth: Number.isInteger(month) && month >= 1 && month <= 12 ? month : DEFAULT_GST_SETTINGS.periodEndMonth,
  };
}

export function parseGstSettings(raw: unknown): { ok: true; value: GstSettings } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (!isGstFrequency(o.frequency)) return { ok: false, error: 'Frequency must be monthly, two_monthly or six_monthly' };
  const m = Number(o.periodEndMonth);
  if (!Number.isInteger(m) || m < 1 || m > 12) return { ok: false, error: 'Period end month must be 1 to 12' };
  return { ok: true, value: { frequency: o.frequency, periodEndMonth: m } };
}

export function setGstSettings(db: Database, userId: string, businessId: string, s: GstSettings): void {
  run(db, `UPDATE businesses SET gst_frequency = ?, gst_period_end_month = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [
    s.frequency,
    s.periodEndMonth,
    new Date().toISOString(),
    businessId,
    userId,
  ]);
}

/** Mark how a tagged item counts for GST; null goes back to the default. Only this business's items. */
export function setItemGst(db: Database, userId: string, businessId: string, kind: 'income' | 'transaction', id: string, treatment: GstTreatment | null): boolean {
  const table = kind === 'income' ? 'income_records' : 'transactions';
  const found = queryOne(db, `SELECT id FROM ${table} WHERE id = ? AND user_id = ? AND business_id = ?`, [id, userId, businessId]);
  if (!found) return false;
  if (kind === 'income' && queryOne(db, `SELECT id FROM income_records WHERE id = ? AND invoice_payment_id IS NOT NULL`, [id])) return false;
  run(db, `UPDATE ${table} SET gst_treatment = ? WHERE id = ? AND user_id = ?`, [treatment, id, userId]);
  return true;
}

const gstOf = (n: number, t: GstTreatment) => (t === 'standard' ? roundMoney((n * 3) / 23) : 0);
const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Every item a GST return counts in [start, end], with its GST treatment and content. */
export function gstItems(db: Database, userId: string, businessId: string, start: string, end: string): GstItem[] {
  const money = businessMoney(db, userId, businessId, start, end);
  const items: GstItem[] = [];

  // Invoice payments: standard when the invoice charged GST, else zero-rated.
  const pays = money.payments.length
    ? queryAll<{ id: string; date: string; amount_nzd: number; number: string; client_name: string; gst_nzd: number }>(
        db,
        `SELECT p.id, p.date, p.amount_nzd, i.number, i.client_name, i.gst_nzd FROM invoice_payments p
         JOIN invoices i ON i.id = p.invoice_id AND i.user_id = p.user_id
         WHERE p.user_id = ? AND p.id IN (${ph(money.payments.length)})`,
        [userId, ...money.payments.map((p) => p.id)],
      )
    : [];
  for (const p of pays) {
    const treatment: GstTreatment = Number(p.gst_nzd) > 0 ? 'standard' : 'zero';
    const amount = roundMoney(Number(p.amount_nzd));
    items.push({ kind: 'invoice_payment', id: p.id, date: p.date, description: `Invoice ${p.number}${p.client_name ? ` · ${p.client_name}` : ''}`, amountNzd: amount, side: 'sale', treatment, marked: false, editable: false, gstNzd: gstOf(amount, treatment) });
  }

  // Sales are GST-inclusive at the standard rate (KAN-120).
  for (const s of money.sales) {
    items.push({ kind: 'sale', id: s.id, date: s.date, description: s.description, amountNzd: s.amountNzd, side: 'sale', treatment: 'standard', marked: false, editable: false, gstNzd: gstOf(s.amountNzd, 'standard') });
  }

  const counted = money.items.filter((i) => !i.countedVia);
  const txnIds = counted.filter((i) => i.kind === 'transaction').map((i) => i.id);
  const incIds = counted.filter((i) => i.kind === 'income').map((i) => i.id);
  const txnInfo = new Map(
    (txnIds.length ? queryAll<{ id: string; kind: string; g: string | null }>(db, `SELECT id, kind, gst_treatment AS g FROM transactions WHERE user_id = ? AND id IN (${ph(txnIds.length)})`, [userId, ...txnIds]) : []).map((r) => [r.id, r]),
  );
  const incInfo = new Map(
    (incIds.length ? queryAll<{ id: string; g: string | null }>(db, `SELECT id, gst_treatment AS g FROM income_records WHERE user_id = ? AND id IN (${ph(incIds.length)})`, [userId, ...incIds]) : []).map((r) => [r.id, r.g]),
  );
  for (const item of counted) {
    if (item.kind === 'income') {
      const stored = incInfo.get(item.id);
      const treatment: GstTreatment = isGstTreatment(stored) ? stored : 'standard';
      const amount = roundMoney(item.amountNzd);
      items.push({ kind: 'income', id: item.id, date: item.date, description: item.description, amountNzd: amount, side: 'sale', treatment, marked: isGstTreatment(stored), editable: true, gstNzd: gstOf(amount, treatment) });
      continue;
    }
    const info = txnInfo.get(item.id);
    if (!info || info.kind === 'transfer' || item.amountNzd === 0) continue;
    const sale = item.amountNzd > 0;
    const stored = isGstTreatment(info.g) ? info.g : null;
    // Sales are GST-inclusive by default; a purchase is only claimed once it's marked.
    const treatment: GstTreatment = stored ?? (sale ? 'standard' : 'exempt');
    const amount = roundMoney(Math.abs(item.amountNzd));
    items.push({ kind: 'transaction', id: item.id, date: item.date, description: item.description, amountNzd: amount, side: sale ? 'sale' : 'purchase', treatment, marked: stored != null, editable: true, gstNzd: gstOf(amount, treatment) });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return items;
}

export function gstReturn(db: Database, userId: string, business: { id: string; gstRegistered: boolean }, date: string): GstReturnView {
  const settings = gstSettingsOf(db, userId, business.id);
  const period = periodContaining(date, settings);
  const items = gstItems(db, userId, business.id, period.start, period.end);
  return { registered: business.gstRegistered, settings, period, dueDate: gstDueDate(period.end), boxes: boxesFor(items), items };
}

/** The GST101A boxes for a set of items. */
export function boxesFor(items: GstItem[]): Gst101a {
  const sales = items.filter((i) => i.side === 'sale' && i.treatment !== 'exempt');
  return gst101a({
    salesInclNzd: sales.reduce((s, i) => s + i.amountNzd, 0),
    zeroRatedNzd: sales.filter((i) => i.treatment === 'zero').reduce((s, i) => s + i.amountNzd, 0),
    purchasesInclNzd: items.filter((i) => i.side === 'purchase' && i.treatment === 'standard').reduce((s, i) => s + i.amountNzd, 0),
  });
}
