/**
 * Accountant export (KAN-128): one business, one period, as CSV. Built from the same items as
 * the P&L (categorisedItems) and the GST return (gstItems), so the three always agree.
 *   pnl           income and expense lines, totals and net profit
 *   transactions  every counted item: date, description, source, category, money in or out, and
 *                 for a GST-registered business its GST treatment and GST amount
 *   invoices      the invoice register: invoices issued in the period (drafts left out)
 *   gst           each GST return period that overlaps the period, as GST101A boxes
 * `all` puts the four in one file, each under a title row with a blank row between. No ids, no
 * secrets: the columns are named here, never copied from the database (the cleanRow rule).
 * Text cells that look like formulas are neutralised (csvCell).
 */
import type { Database } from 'sql.js';
import { periodContaining, shiftPeriod } from '../../src/lib/gst.ts';
import { roundMoney } from '../../src/lib/debtModel.ts';
import { queryAll } from '../db/index.ts';
import { csvCell, summary } from '../invoices/store.ts';
import { categorisedItems } from './profitLoss.ts';
import { boxesFor, gstItems, gstSettingsOf } from './gst.ts';
import { gstDueDate } from '../../src/lib/gst.ts';

export const EXPORT_SECTIONS = ['all', 'pnl', 'transactions', 'invoices', 'gst'] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];
export const isExportSection = (v: unknown): v is ExportSection => (EXPORT_SECTIONS as readonly unknown[]).includes(v);

type Cell = string | number | null;
const row = (cells: Cell[]) => cells.map(csvCell).join(',');

const SOURCE: Record<string, string> = { invoice: 'Invoice payment', income: 'Income', bank: 'Bank', sale: 'Sale', bill: 'Supplier bill', wage: 'Wages' };
const TREATMENT: Record<string, string> = { standard: 'GST-inclusive 15%', zero: 'Zero-rated', exempt: 'No GST' };

export const COLUMNS = {
  pnl: ['Section', 'Line', 'Source', 'Items', 'Amount (NZD)'],
  transactions: ['Date', 'Description', 'Source', 'Category', 'Money in (NZD)', 'Money out (NZD)'],
  transactionsGst: ['GST treatment', 'GST amount (NZD)'],
  invoices: ['Number', 'Status', 'Issue date', 'Due date', 'Client', 'Reference', 'Subtotal excl. GST (NZD)', 'GST (NZD)', 'Total (NZD)', 'Paid (NZD)', 'Balance (NZD)'],
  gst: [
    'Period start',
    'Period end',
    'Due',
    'Box 5 Sales incl. GST',
    'Box 6 Zero-rated',
    'Box 8 GST on sales',
    'Box 10 GST collected',
    'Box 11 Purchases incl. GST',
    'Box 12 GST on purchases',
    'Box 14 GST credit',
    'Box 15 To pay (refund if negative)',
  ],
} as const;

export function accountantCsv(
  db: Database,
  userId: string,
  business: { id: string; name: string; gstRegistered: boolean },
  period: { start: string; end: string },
  today: string,
  section: ExportSection,
): string {
  const { money, items } = categorisedItems(db, userId, business.id, period.start, period.end);
  const tables: { title: string; lines: string[] }[] = [];
  const want = (s: ExportSection) => section === 'all' || section === s;

  if (want('pnl')) {
    const lines = [row([...COLUMNS.pnl])];
    const groups = new Map<string, { section: string; label: string; source: string; count: number; amount: number }>();
    for (const i of items) {
      const sec = i.amountNzd > 0 ? 'Income' : 'Expenses';
      const key = `${sec}|${i.source}|${i.label}`;
      const g = groups.get(key) ?? { section: sec, label: i.label, source: SOURCE[i.source], count: 0, amount: 0 };
      g.count += 1;
      g.amount += Math.abs(i.amountNzd);
      groups.set(key, g);
    }
    const sorted = [...groups.values()].sort((a, b) => a.section.localeCompare(b.section) * -1 || b.amount - a.amount || a.label.localeCompare(b.label));
    for (const g of sorted) lines.push(row([g.section, g.label, g.source, g.count, roundMoney(g.amount)]));
    lines.push(row(['Total', 'Income', '', '', money.incomeNzd]));
    lines.push(row(['Total', 'Expenses', '', '', money.expensesNzd]));
    lines.push(row(['Total', 'Net profit', '', '', roundMoney(money.incomeNzd - money.expensesNzd)]));
    tables.push({ title: 'Profit and loss', lines });
  }

  if (want('transactions')) {
    const gst = business.gstRegistered ? new Map(gstItems(db, userId, business.id, period.start, period.end).map((g) => [`${g.kind}:${g.id}`, g])) : null;
    const lines = [row([...COLUMNS.transactions, ...(gst ? COLUMNS.transactionsGst : [])])];
    for (const i of items) {
      const g = gst?.get(`${i.kind}:${i.id}`);
      const base: Cell[] = [i.date, i.description, SOURCE[i.source], i.label, i.amountNzd > 0 ? i.amountNzd : null, i.amountNzd < 0 ? -i.amountNzd : null];
      lines.push(row(gst ? [...base, g ? TREATMENT[g.treatment] : '', g ? g.gstNzd : null] : base));
    }
    tables.push({ title: 'Transactions', lines });
  }

  if (want('invoices')) {
    const lines = [row([...COLUMNS.invoices])];
    const invoices = queryAll<Parameters<typeof summary>[2] & { subtotal_nzd: number; gst_nzd: number; total_nzd: number; reference: string; number_key: string }>(
      db,
      `SELECT * FROM invoices WHERE user_id = ? AND business_id = ? AND status != 'draft' AND issue_date >= ? AND issue_date <= ? ORDER BY issue_date, number_key`,
      [userId, business.id, period.start, period.end],
    );
    for (const r of invoices) {
      const s = summary(db, userId, r, today);
      lines.push(row([s.number, s.status, s.issueDate, s.dueDate, s.clientName, r.reference ?? '', Number(r.subtotal_nzd), Number(r.gst_nzd), Number(r.total_nzd), s.paidNzd, s.balanceNzd]));
    }
    tables.push({ title: 'Invoices issued', lines });
  }

  if (want('gst') && business.gstRegistered) {
    const settings = gstSettingsOf(db, userId, business.id);
    const lines = [row([...COLUMNS.gst])];
    for (let p = periodContaining(period.start, settings); p.start <= period.end; p = shiftPeriod(p, settings, 1)) {
      const b = boxesFor(gstItems(db, userId, business.id, p.start, p.end));
      lines.push(row([p.start, p.end, gstDueDate(p.end), b.box5, b.box6, b.box8, b.box10, b.box11, b.box12, b.box14, b.box15]));
    }
    tables.push({ title: 'GST returns (payments basis; whole periods that overlap; an estimate to check in myIR)', lines });
  }

  if (section !== 'all') return `${(tables[0]?.lines ?? []).join('\r\n')}\r\n`;
  const head = [
    row(['Business', business.name]),
    row(['Period', `${period.start} to ${period.end}`]),
    row(['Prepared', `${today} by KoruLedger`]),
    row(['Note', 'Each dollar is counted once; transfers between own accounts are left out. Figures are estimates to check.']),
  ];
  return `${[head.join('\r\n'), ...tables.map((t) => [row([t.title]), ...t.lines].join('\r\n'))].join('\r\n\r\n')}\r\n`;
}

/** 'kowhai-honey' for a file name. */
export function fileSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'business'
  );
}
