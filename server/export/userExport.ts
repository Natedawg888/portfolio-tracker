/**
 * CSV / PDF export (KAN-63) of the signed-in user's budget, portfolio / assets and KiwiSaver.
 *
 * CSV sections (or 'all', one file with a titled table per section):
 *   budget    month, category, type, planned, actual: each month in the range, per category with a
 *             plan or activity (spending = money out, income = money in; transfers left out)
 *   assets    every holding valued as in net worth (computeNetWorth), by asset class, plus totals
 *   kiwisaver accounts with balance and returns, then the recorded balance history
 * PDF: a one-to-two page summary for the same range: net worth by asset class today, income /
 *   spending / saved per month, top spending categories, KiwiSaver balances.
 * Real stored rows only; nothing estimated. Amounts NZD.
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Database } from 'sql.js';
import { queryAll } from '../db/index.ts';
import { computeNetWorth, type WalletValuer } from '../lib/netWorth.ts';
import { homeMonthSnapshot } from '../budget/homeSnapshot.ts';
import { planTotalsForMonth } from '../budget/planTotals.ts';
import { A4, INK, MARGIN, MUTED, RULE, fonts, formatMoney } from '../invoices/pdf.ts';

export const EXPORT_SECTIONS = ['budget', 'assets', 'kiwisaver', 'all'] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

const CLASS_LABEL: Record<string, string> = {
  stock: 'Shares & funds',
  crypto: 'Crypto',
  gomining_miner: 'Crypto mining',
  metal: 'Metals',
  forex: 'Foreign cash',
  real_estate: 'Property',
  art: 'Art',
  stone: 'Precious stones',
  collectable: 'Collectables',
  kiwisaver: 'KiwiSaver',
  bond: 'Bonds & term deposits',
  commodity: 'Commodities',
  vehicle: 'Vehicles',
  business: 'Businesses',
  defi: 'DeFi',
};

/** One CSV cell: quoted when needed; formula-looking text neutralised for spreadsheets. */
export function cell(v: unknown): string {
  if (v == null) return '';
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '') : String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number' && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (vals: unknown[]) => vals.map(cell).join(',');

/** YYYY-MM months from `from` to `to`, inclusive (max 120). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 120) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function budgetRows(db: Database, userId: string, months: string[]): string[][] {
  const out: string[][] = [];
  for (const month of months) {
    const planned = planTotalsForMonth(db, userId, month);
    const plans = queryAll<{ id: string; name: string; type: string; actual: number | null }>(
      db,
      `SELECT c.id, c.name, c.type,
              (SELECT SUM(CASE WHEN c.type = 'income' THEN t.amount ELSE -t.amount END) FROM transactions t
                WHERE t.user_id = c.user_id AND t.category_id = c.id AND substr(t.date, 1, 7) = ?
                  AND ((c.type = 'income' AND t.amount > 0) OR (c.type = 'spending' AND t.amount < 0))) AS actual
       FROM budget_categories c WHERE c.user_id = ? AND c.type IN ('spending', 'income') ORDER BY c.type DESC, c.name COLLATE NOCASE`,
      [month, userId],
    );
    for (const p of plans) {
      const plan = planned.get(p.id);
      const plannedNzd = plan && plan.n > 0 ? plan.total : null;
      if (plannedNzd == null && p.actual == null) continue;
      out.push([month, p.name, p.type, plannedNzd == null ? '' : String(Math.round(plannedNzd * 100) / 100), String(Math.round((p.actual ?? 0) * 100) / 100)]);
    }
  }
  return out;
}

export async function assetRows(db: Database, userId: string, valuer?: WalletValuer): Promise<{ rows: string[][]; netWorth: Awaited<ReturnType<typeof computeNetWorth>> }> {
  const nw = valuer ? await computeNetWorth(db, userId, valuer) : await computeNetWorth(db, userId);
  const rows = [...nw.breakdown.holdings]
    .sort((a, b) => (CLASS_LABEL[a.assetClass] ?? a.assetClass).localeCompare(CLASS_LABEL[b.assetClass] ?? b.assetClass) || b.valueNzd - a.valueNzd)
    .map((h) => [CLASS_LABEL[h.assetClass] ?? h.assetClass, h.label, String(Math.round(h.valueNzd * 100) / 100)]);
  return { rows, netWorth: nw };
}

export function kiwiSaverRows(db: Database, userId: string, from: string, to: string): { accounts: string[][]; history: string[][] } {
  const accounts = queryAll<{ id: string; name: string; provider: string; scheme_name: string | null; balance_nzd: number; returns_nzd: number | null; observed_at: string | null }>(
    db,
    `SELECT id, name, provider, scheme_name, balance_nzd, returns_nzd, observed_at FROM kiwisaver_accounts WHERE user_id = ? ORDER BY name`,
    [userId],
  );
  const history = queryAll<{ name: string; observed_at: string; balance_nzd: number; returns_nzd: number | null; source: string }>(
    db,
    `SELECT a.name, h.observed_at, h.balance_nzd, h.returns_nzd, h.source FROM kiwisaver_balance_history h
     JOIN kiwisaver_accounts a ON a.id = h.account_id WHERE a.user_id = ? AND substr(h.observed_at, 1, 7) >= ? AND substr(h.observed_at, 1, 7) <= ?
     ORDER BY h.observed_at, a.name`,
    [userId, from, to],
  );
  return {
    accounts: accounts.map((a) => [a.name, a.scheme_name ?? a.provider, String(a.balance_nzd), a.returns_nzd == null ? '' : String(a.returns_nzd), (a.observed_at ?? '').slice(0, 10)]),
    history: history.map((h) => [h.observed_at.slice(0, 10), h.name, String(h.balance_nzd), h.returns_nzd == null ? '' : String(h.returns_nzd), h.source]),
  };
}

export async function exportCsv(db: Database, userId: string, section: ExportSection, from: string, to: string, valuer?: WalletValuer): Promise<string> {
  const tables: { title: string; lines: string[] }[] = [];
  if (section === 'budget' || section === 'all') {
    tables.push({ title: 'Budget', lines: [row(['Month', 'Category', 'Type', 'Planned NZD', 'Actual NZD']), ...budgetRows(db, userId, monthsBetween(from, to)).map(row)] });
  }
  if (section === 'assets' || section === 'all') {
    const { rows, netWorth } = await assetRows(db, userId, valuer);
    tables.push({
      title: 'Portfolio and assets',
      lines: [row(['Asset class', 'Holding', 'Value NZD']), ...rows.map(row), row([]), row(['Total assets', '', netWorth.assetsKnownNzd]), row(['Net worth', '', netWorth.totalKnownNzd])],
    });
  }
  if (section === 'kiwisaver' || section === 'all') {
    const ks = kiwiSaverRows(db, userId, from, to);
    tables.push({ title: 'KiwiSaver accounts', lines: [row(['Account', 'Scheme', 'Balance NZD', 'Returns NZD', 'As of']), ...ks.accounts.map(row)] });
    tables.push({ title: 'KiwiSaver balance history', lines: [row(['Date', 'Account', 'Balance NZD', 'Returns NZD', 'Source']), ...ks.history.map(row)] });
  }
  if (section !== 'all') return `${tables.flatMap((t) => t.lines).join('\r\n')}\r\n`;
  return `${tables.map((t) => [row([t.title]), ...t.lines].join('\r\n')).join('\r\n\r\n')}\r\n`;
}

// --- PDF summary ---------------------------------------------------------------------

type Ctx = { doc: PDFDocument; page: PDFPage; y: number; regular: PDFFont; bold: PDFFont };

function ensure(c: Ctx, space: number): void {
  if (c.y - space > MARGIN) return;
  c.page = c.doc.addPage([A4.w, A4.h]);
  c.y = A4.h - MARGIN;
}
function text(c: Ctx, s: string, size: number, opts: { bold?: boolean; muted?: boolean; x?: number } = {}): void {
  ensure(c, size + 6);
  c.page.drawText(s, { x: opts.x ?? MARGIN, y: c.y - size, size, font: opts.bold ? c.bold : c.regular, color: opts.muted ? MUTED : INK });
  c.y -= size + 6;
}
function line2(c: Ctx, left: string, right: string, size = 10, bold = false): void {
  ensure(c, size + 6);
  const font = bold ? c.bold : c.regular;
  c.page.drawText(left.slice(0, 70), { x: MARGIN, y: c.y - size, size, font, color: INK });
  c.page.drawText(right, { x: A4.w - MARGIN - font.widthOfTextAtSize(right, size), y: c.y - size, size, font, color: INK });
  c.y -= size + 5;
}
function rule(c: Ctx): void {
  ensure(c, 10);
  c.page.drawLine({ start: { x: MARGIN, y: c.y - 3 }, end: { x: A4.w - MARGIN, y: c.y - 3 }, thickness: 0.5, color: RULE });
  c.y -= 10;
}

export async function exportPdf(db: Database, userId: string, from: string, to: string, today: string, valuer?: WalletValuer): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = fonts();
  const c: Ctx = { doc, page: doc.addPage([A4.w, A4.h]), y: A4.h - MARGIN, regular: await doc.embedFont(f.regular, { subset: true }), bold: await doc.embedFont(f.bold, { subset: true }) };
  doc.setTitle('KoruLedger summary');
  doc.setProducer('KoruLedger');

  text(c, 'KoruLedger summary', 18, { bold: true });
  text(c, `${from} to ${to} · made ${today} · amounts in NZD`, 9, { muted: true });
  c.y -= 6;

  const { rows, netWorth } = await assetRows(db, userId, valuer);
  text(c, 'Net worth today', 13, { bold: true });
  const byClass = new Map<string, number>();
  for (const r of rows) byClass.set(r[0], (byClass.get(r[0]) ?? 0) + Number(r[2]));
  for (const [k, v] of [...byClass].sort((a, b) => b[1] - a[1])) line2(c, k, formatMoney(v));
  rule(c);
  line2(c, 'Total assets', formatMoney(netWorth.assetsKnownNzd), 10, true);
  line2(c, 'Net worth', formatMoney(netWorth.totalKnownNzd), 11, true);
  c.y -= 8;

  text(c, 'Budget by month', 13, { bold: true });
  line2(c, 'Month   ·   income   ·   spending', 'saved', 9);
  let inc = 0;
  let spend = 0;
  const spendByCat = new Map<string, number>();
  for (const m of monthsBetween(from, to)) {
    const s = homeMonthSnapshot(db, userId, m);
    if (!s) continue;
    inc += s.incomeNzd;
    spend += s.spendingNzd;
    line2(c, `${m}   ·   ${formatMoney(s.incomeNzd)}   ·   ${formatMoney(s.spendingNzd)}`, formatMoney(s.savingsNzd));
  }
  for (const r of budgetRows(db, userId, monthsBetween(from, to))) if (r[2] === 'spending') spendByCat.set(r[1], (spendByCat.get(r[1]) ?? 0) + Number(r[4]));
  rule(c);
  line2(c, 'Total', formatMoney(inc - spend), 10, true);
  text(c, `Income ${formatMoney(inc)} · spending ${formatMoney(spend)}`, 9, { muted: true });
  const top = [...spendByCat].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) {
    c.y -= 6;
    text(c, 'Top spending categories', 11, { bold: true });
    for (const [k, v] of top) line2(c, k, formatMoney(v));
  }
  c.y -= 8;

  const ks = kiwiSaverRows(db, userId, from, to);
  text(c, 'KiwiSaver', 13, { bold: true });
  if (!ks.accounts.length) text(c, 'No KiwiSaver accounts.', 10, { muted: true });
  for (const a of ks.accounts) line2(c, `${a[0]}${a[1] ? ` · ${a[1]}` : ''}`, formatMoney(Number(a[2])));
  c.y -= 10;
  text(c, 'From what you have recorded in KoruLedger. A record, not financial advice.', 8, { muted: true });
  return doc.save();
}
