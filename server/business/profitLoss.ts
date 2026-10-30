/**
 * Profit & loss for one business (KAN-126), for a tax year or any period. Built on
 * businessMoney, so the totals follow its count-once rules and a tax year matches the business
 * card (businessTotals) exactly; this only splits them into lines and months:
 *   income   invoice payments; tagged income not tied to an invoice, by its income category;
 *            tagged bank deposits not already counted, by business category, else budget
 *            category, else "Bank deposits"
 *   expenses tagged bank debits, by business category, else budget category, else
 *            "Uncategorised". Transfers between the user's own accounts are neither.
 * Employee pay counts when it's a tagged bank debit (e.g. in a Wages category). Pay rates on
 * Employees are records, not payments, so they never add an expense here.
 */
import type { Database } from 'sql.js';
import type { ProfitLoss, ProfitLossLine } from '../../src/types/index.ts';
import { roundMoney } from '../../src/lib/debtModel.ts';
import { queryAll } from '../db/index.ts';
import { businessMoney, invoiceFigures } from './store.ts';

type Bucket = { label: string; source: ProfitLossLine['source']; amount: number; count: number };

function add(map: Map<string, Bucket>, label: string, source: ProfitLossLine['source'], amount: number) {
  const key = `${source}:${label}`;
  const b = map.get(key) ?? { label, source, amount: 0, count: 0 };
  b.amount += amount;
  b.count += 1;
  map.set(key, b);
}

function lines(map: Map<string, Bucket>): ProfitLossLine[] {
  const order: Record<ProfitLossLine['source'], number> = { invoice: 0, sale: 1, income: 2, bill: 3, wage: 4, bank: 5 };
  return [...map.values()]
    .filter((b) => b.count > 0)
    .sort((a, b) => order[a.source] - order[b.source] || b.amount - a.amount || a.label.localeCompare(b.label))
    .map((b) => ({ label: b.label, source: b.source, amountNzd: roundMoney(b.amount), count: b.count }));
}

/** Every 'YYYY-MM' from start's month to end's month. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.slice(0, 7).split('-').map(Number);
  const [ey, em] = end.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** One counted item with the P&L line it lands on. Money in is positive, money out negative. */
export type CategorisedItem = {
  kind: 'invoice_payment' | 'income' | 'transaction' | 'sale' | 'bill' | 'wage';
  id: string;
  date: string;
  description: string;
  amountNzd: number;
  source: ProfitLossLine['source'];
  /** The P&L line: a category, "Invoice payments", or the fallbacks in the header. */
  label: string;
};

/**
 * Every item the P&L counts in [start, end], once each, with its line. Shared by the P&L and
 * the accountant export, so the two always agree.
 */
export function categorisedItems(db: Database, userId: string, businessId: string, start: string, end: string) {
  const money = businessMoney(db, userId, businessId, start, end);
  const txnIds = money.items.filter((i) => i.kind === 'transaction').map((i) => i.id);
  const incomeIds = money.items.filter((i) => i.kind === 'income').map((i) => i.id);

  const txnInfo = new Map(
    (txnIds.length
      ? queryAll<{ id: string; kind: string; biz_cat: string | null; cat: string | null }>(
          db,
          `SELECT t.id, t.kind, bc.name AS biz_cat, c.name AS cat FROM transactions t
           LEFT JOIN business_budget_categories bc ON bc.id = t.business_category_id AND bc.user_id = t.user_id AND bc.business_id = t.business_id
           LEFT JOIN budget_categories c ON c.id = t.category_id AND c.user_id = t.user_id
           WHERE t.user_id = ? AND t.id IN (${placeholders(txnIds.length)})`,
          [userId, ...txnIds],
        )
      : []
    ).map((r) => [r.id, r]),
  );
  const incomeCat = new Map(
    (incomeIds.length
      ? queryAll<{ id: string; cat: string | null }>(
          db,
          `SELECT r.id, c.name AS cat FROM income_records r LEFT JOIN budget_categories c ON c.id = r.category_id AND c.user_id = r.user_id
           WHERE r.user_id = ? AND r.id IN (${placeholders(incomeIds.length)})`,
          [userId, ...incomeIds],
        )
      : []
    ).map((r) => [r.id, r.cat]),
  );
  const invoiceOf = new Map(
    (money.payments.length
      ? queryAll<{ id: string; number: string; client_name: string }>(
          db,
          `SELECT p.id, i.number, i.client_name FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id AND i.user_id = p.user_id
           WHERE p.user_id = ? AND p.id IN (${placeholders(money.payments.length)})`,
          [userId, ...money.payments.map((p) => p.id)],
        )
      : []
    ).map((r) => [r.id, r]),
  );

  const items: CategorisedItem[] = [];
  for (const p of money.payments) {
    const inv = invoiceOf.get(p.id);
    const description = inv ? `Invoice ${inv.number}${inv.client_name ? ` · ${inv.client_name}` : ''}` : 'Invoice payment';
    items.push({ kind: 'invoice_payment', id: p.id, date: p.date, description, amountNzd: p.amountNzd, source: 'invoice', label: 'Invoice payments' });
  }
  for (const s of money.sales) {
    items.push({ kind: 'sale', id: s.id, date: s.date, description: s.description, amountNzd: s.amountNzd, source: 'sale', label: 'Sales' });
  }
  for (const b of money.bills) {
    items.push({ kind: 'bill', id: b.id, date: b.date, description: b.description, amountNzd: -b.amountNzd, source: 'bill', label: b.kind === 'delivery' ? 'Delivery' : 'Stock purchases' });
  }
  for (const w of money.wages) {
    items.push({ kind: 'wage', id: w.id, date: w.date, description: w.description, amountNzd: -w.amountNzd, source: 'wage', label: 'Wages' });
  }
  for (const item of money.items) {
    // Counted once already: an invoice payment, or the income row a deposit is linked to.
    if (item.countedVia) continue;
    if (item.kind === 'income') {
      items.push({ kind: 'income', id: item.id, date: item.date, description: item.description, amountNzd: item.amountNzd, source: 'income', label: incomeCat.get(item.id)?.trim() || 'Other income' });
      continue;
    }
    const info = txnInfo.get(item.id);
    if (!info || info.kind === 'transfer' || item.amountNzd === 0) continue;
    const category = info.biz_cat?.trim() || info.cat?.trim() || '';
    const label = category || (item.amountNzd > 0 ? 'Bank deposits' : 'Uncategorised');
    items.push({ kind: 'transaction', id: item.id, date: item.date, description: item.description, amountNzd: item.amountNzd, source: 'bank', label });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { money, items };
}

export function profitLoss(
  db: Database,
  userId: string,
  business: { id: string; name: string },
  period: { start: string; end: string; taxYear: number | null; taxYears: number[] },
  today: string,
): ProfitLoss {
  const { start, end } = period;
  const { money, items } = categorisedItems(db, userId, business.id, start, end);
  const months = new Map(monthsBetween(start, end).map((m) => [m, { income: 0, expenses: 0 }]));
  const income = new Map<string, Bucket>();
  const expenses = new Map<string, Bucket>();
  for (const item of items) {
    const mo = months.get(item.date.slice(0, 7));
    if (item.amountNzd > 0) {
      add(income, item.label, item.source, item.amountNzd);
      if (mo) mo.income += item.amountNzd;
    } else {
      add(expenses, item.label, item.source, -item.amountNzd);
      if (mo) mo.expenses += -item.amountNzd;
    }
  }

  return {
    businessId: business.id,
    businessName: business.name,
    start,
    end,
    taxYear: period.taxYear,
    taxYears: period.taxYears,
    income: lines(income),
    expenses: lines(expenses),
    incomeNzd: money.incomeNzd,
    expensesNzd: money.expensesNzd,
    netNzd: roundMoney(money.incomeNzd - money.expensesNzd),
    months: [...months].map(([month, v]) => ({ month, incomeNzd: roundMoney(v.income), expensesNzd: roundMoney(v.expenses) })),
    invoices: invoiceFigures(db, userId, business.id, today, money.invoicePaidNzd),
  };
}
