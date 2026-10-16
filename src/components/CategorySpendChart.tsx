/**
 * Category spend charts — SVG bar + pie (no chart library).
 * Aggregates NZD outflows (negative amounts) by spending category only
 * (excludes income, transfer_out, transfer_in).
 *
 * Debt / I-owe: only repayment amounts and cat-debt transactions in the period
 * count as spend. Outstanding balances on debt_people are NEVER included here
 * (they reduce net worth on the Dashboard / Yearly report instead).
 */
import { useMemo, useState } from 'react';
import { formatNzd } from '../api/client';
import { categoryColourFor, UNCATEGORISED_COLOUR } from '../lib/categoryColours';
import {
  categoryTypeCountsAsSpend,
  normalizeCategoryType,
  type CategoryType,
} from '../lib/categoryTypes';

export type ChartCategory = {
  id: string;
  /** Well-known key e.g. cat-debt; falls back to id when absent. */
  slug?: string;
  name: string;
  type?: CategoryType;
  isIncome?: boolean;
  /** Saved colour (#rrggbb); falls back to the palette. */
  colour?: string | null;
  /** Orders the automatic colours (categoryColourFor). */
  sortOrder?: number;
};

function isDebtCategory(categoryId: string | null | undefined, categories: ChartCategory[]): boolean {
  if (!categoryId) return false;
  if (categoryId === 'cat-debt' || categoryId.startsWith('cat-debt__')) return true;
  const cat = categories.find((c) => c.id === categoryId);
  const slug = cat?.slug ?? cat?.id;
  return slug === 'cat-debt';
}

function debtCategoryId(categories: ChartCategory[]): string {
  const hit = categories.find((c) => (c.slug ?? c.id) === 'cat-debt' || c.id === 'cat-debt' || c.id.startsWith('cat-debt__'));
  return hit?.id ?? 'cat-debt';
}

export type ChartTransaction = {
  id?: string;
  amount: number;
  categoryId?: string | null;
  date?: string;
};

export type ChartDebtRepayment = {
  amountNzd: number;
  date: string;
  /** A linked debt repayment is already represented by its cat-debt transaction. */
  transactionId?: string | null;
};

export type CategorySpendRow = {
  key: string;
  categoryId: string | null;
  name: string;
  spend: number;
  colour: string;
};

export function aggregateCategorySpend(
  txns: ChartTransaction[],
  categories: ChartCategory[],
  fromDate = '2026-10-01',
  toDate?: string,
  repayments: ChartDebtRepayment[] = [],
): CategorySpendRow[] {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const typeById = new Map(
    categories.map((c) => [c.id, normalizeCategoryType(c.type, c.isIncome)]),
  );
  const totals = new Map<string, { categoryId: string | null; name: string; spend: number }>();
  const debtTransactionIds = new Set<string>();

  const addSpend = (categoryId: string | null, spend: number, fallbackName: string) => {
    const key = categoryId ?? '__uncategorised__';
    const name = categoryId ? (nameById.get(categoryId) ?? fallbackName) : fallbackName;
    const prev = totals.get(key);
    if (prev) prev.spend += spend;
    else totals.set(key, { categoryId, name, spend });
  };

  for (const t of txns) {
    if (t.date && t.date < fromDate) continue;
    if (toDate && t.date && t.date > toDate) continue;
    const amt = Number(t.amount);
    if (!Number.isFinite(amt) || amt >= 0) continue; // outflows only
    const categoryId = t.categoryId ?? null;
    // Only real spending categories count. Income / transfer_out / transfer_in excluded.
    // Uncategorised outflows still count as spend.
    if (categoryId) {
      const catType = typeById.get(categoryId) ?? 'spending';
      if (!categoryTypeCountsAsSpend(catType)) continue;
    }
    if (isDebtCategory(categoryId, categories) && t.id) debtTransactionIds.add(t.id);
    addSpend(categoryId, Math.abs(amt), isDebtCategory(categoryId, categories) ? 'Debt' : 'Unknown');
  }

  // Repayments without a counted cat-debt transaction still represent a Debt outflow.
  // Linked repayments whose transaction is already counted are skipped to avoid double count.
  const debtId = debtCategoryId(categories);
  for (const repayment of repayments) {
    if (repayment.date < fromDate || (toDate && repayment.date > toDate)) continue;
    if (repayment.transactionId && debtTransactionIds.has(repayment.transactionId)) continue;
    const amount = Number(repayment.amountNzd);
    if (Number.isFinite(amount) && amount > 0) addSpend(debtId, amount, 'Debt');
  }


  const rows = Array.from(totals.entries())
    .map(([key, row]) => ({
      key,
      categoryId: row.categoryId,
      name: row.name,
      spend: row.spend,
      colour: UNCATEGORISED_COLOUR,
    }))
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.spend - a.spend);

  // A saved colour wins; Auto is fixed by the category's place in the list, not by spend.
  return rows.map((r) => ({
    ...r,
    colour: r.categoryId == null ? UNCATEGORISED_COLOUR : categoryColourFor(categories, r.categoryId),
  }));
}

type ChartMode = 'bar' | 'pie';

type Props = {
  rows: CategorySpendRow[];
  /** Human period label, e.g. "Oct 2026" or "1 Oct 2026 → 31 Oct 2026" */
  periodLabel?: string;
  /** @deprecated use periodLabel */
  fromLabel?: string;
  /** When true, omit duplicate title (parent section already has one). */
  embedded?: boolean;
};

export function CategorySpendChart({
  rows,
  periodLabel,
  fromLabel = '1 Oct 2026',
  embedded = false,
}: Props) {
  const [mode, setMode] = useState<ChartMode>('bar');
  const total = useMemo(() => rows.reduce((s, r) => s + r.spend, 0), [rows]);
  const label = periodLabel ?? fromLabel;

  return (
    <div className={`spend-chart${embedded ? ' embedded' : ''}`}>
      <div className="spend-chart-head">
        <div>
          {!embedded && <h3 className="spend-chart-title">Spend by category</h3>}
          <p className={`muted small spend-chart-kicker${embedded ? '' : ''}`} style={{ margin: embedded ? 0 : '0.15rem 0 0' }}>
            {label} · NZD outflows
          </p>
        </div>
        <div className="chart-toggle" role="group" aria-label="Chart type">
          <button
            type="button"
            className={`btn small${mode === 'bar' ? ' primary' : ''}`}
            aria-pressed={mode === 'bar'}
            onClick={() => setMode('bar')}
          >
            Bar
          </button>
          <button
            type="button"
            className={`btn small${mode === 'pie' ? ' primary' : ''}`}
            aria-pressed={mode === 'pie'}
            onClick={() => setMode('pie')}
          >
            Pie
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted spend-chart-empty">
          No spend yet this period. Sync bank or add a debit to see category charts.
        </p>
      ) : (
        <>
          <p className="muted small spend-chart-total">
            Total <strong>{formatNzd(total)}</strong>
          </p>
          {mode === 'bar' ? <BarChart rows={rows} /> : <PieChart rows={rows} total={total} />}
          <ul className="spend-chart-legend" aria-label="Category totals">
            {rows.map((r) => (
              <li key={r.key}>
                <span className="spend-swatch" style={{ background: r.colour }} aria-hidden />
                <span className="spend-legend-name">{r.name}</span>
                <span className="spend-legend-amt">{formatNzd(r.spend)}</span>
                {total > 0 && (
                  <span className="muted small">{((r.spend / total) * 100).toFixed(0)}%</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BarChart({ rows }: { rows: CategorySpendRow[] }) {
  const max = Math.max(...rows.map((r) => r.spend), 1);
  const barH = 28;
  const gap = 10;
  const labelW = 110;
  const valueW = 72;
  const chartW = 420;
  const plotW = chartW - labelW - valueW;
  const height = rows.length * (barH + gap) + 4;

  return (
    <svg
      className="spend-bar-svg"
      viewBox={`0 0 ${chartW} ${height}`}
      role="img"
      aria-label="Bar chart of spend by category"
    >
      {rows.map((r, i) => {
        const y = i * (barH + gap) + 2;
        const w = Math.max(2, (r.spend / max) * plotW);
        return (
          <g key={r.key}>
            <title>{`${r.name}: ${formatNzd(r.spend)}`}</title>
            <text
              x={0}
              y={y + barH / 2}
              dominantBaseline="middle"
              className="spend-svg-label"
            >
              {truncate(r.name, 14)}
            </text>
            <rect
              x={labelW}
              y={y}
              width={w}
              height={barH}
              rx={6}
              fill={r.colour}
              opacity={0.9}
            />
            <text
              x={labelW + w + 8}
              y={y + barH / 2}
              dominantBaseline="middle"
              className="spend-svg-value"
            >
              {formatNzd(r.spend)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PieChart({ rows, total }: { rows: CategorySpendRow[]; total: number }) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = 88;
  const slices = rows.reduce<
    (CategorySpendRow & { start: number; end: number; frac: number })[]
  >((acc, row) => {
    const frac = total > 0 ? row.spend / total : 0;
    const start = acc.length === 0 ? -Math.PI / 2 : acc[acc.length - 1].end;
    const end = start + frac * Math.PI * 2;
    acc.push({ ...row, start, end, frac });
    return acc;
  }, []);

  return (
    <div className="spend-pie-wrap">
      <svg
        className="spend-pie-svg"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Pie chart of spend by category"
      >
        {slices.length === 1 ? (
          <circle cx={cx} cy={cy} r={r} fill={slices[0].colour}>
            <title>{`${slices[0].name}: ${formatNzd(slices[0].spend)}`}</title>
          </circle>
        ) : (
          slices.map((s) => (
            <path key={s.key} d={arcPath(cx, cy, r, s.start, s.end)} fill={s.colour} opacity={0.92}>
              <title>{`${s.name}: ${formatNzd(s.spend)} (${(s.frac * 100).toFixed(0)}%)`}</title>
            </path>
          ))
        )}
        <circle cx={cx} cy={cy} r={42} fill="var(--surface)" />
        <text x={cx} y={cy - 6} textAnchor="middle" className="spend-svg-value">
          Total
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="spend-svg-label">
          {formatNzd(total)}
        </text>
      </svg>
    </div>
  );
}

/** Same robust wedge builder as AssetBreakdownChart — split arcs > π. */
function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const delta = end - start;
  if (!Number.isFinite(delta) || delta <= 0) return '';
  const pt = (angle: number) => {
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    return `${(Math.round(x * 100) / 100).toFixed(2)} ${(Math.round(y * 100) / 100).toFixed(2)}`;
  };
  const c = `${(Math.round(cx * 100) / 100).toFixed(2)} ${(Math.round(cy * 100) / 100).toFixed(2)}`;
  if (delta >= Math.PI * 2 - 1e-6) {
    const mid = start + Math.PI;
    const a0 = pt(start);
    const a1 = pt(mid);
    return `M ${c} L ${a0} A ${r} ${r} 0 1 1 ${a1} A ${r} ${r} 0 1 1 ${a0} Z`;
  }
  const parts: string[] = [`M ${c} L ${pt(start)}`];
  let from = start;
  while (end - from > Math.PI + 1e-9) {
    const mid = from + Math.PI;
    parts.push(`A ${r} ${r} 0 0 1 ${pt(mid)}`);
    from = mid;
  }
  parts.push(`A ${r} ${r} 0 0 1 ${pt(end)} Z`);
  return parts.join(' ');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
