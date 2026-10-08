/**
 * Yearly report — net-worth / holdings growth from valuation_snapshots.
 * Line graph per asset (class + holding series). Never invents balances.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAuckland, formatNzd } from '../api/client';
import { beginPageRead, commitPageRead, invalidateFinancial, readPageCache } from '../lib/pageDataCache';
import {
  AssetLineChart,
  seriesColour,
  type ChartResolution,
  type LineSeries,
} from '../components/AssetLineChart';
import { DEFAULT_REPORT_YEAR } from '../lib/period';

type SnapshotBreakdown = {
  byClass?: Record<string, number | null>;
  holdings?: Array<{
    id: string;
    label: string;
    assetClass: string;
    valueNzd: number;
  }>;
  asOf?: string;
  quoteNote?: string;
};

type Snapshot = {
  id: string;
  takenAt: string;
  totalNzd: number;
  breakdown: SnapshotBreakdown;
  notes: string | null;
};

type HoldingRow = {
  id: string;
  name?: string;
  assetClass?: string;
  symbol?: string;
  asset?: string;
  costBasisNzd?: number | null;
  estimatedValueNzd?: number | null;
  lastValuationNzd?: number | null;
  valuationNzd?: number | null;
};

/** Red only when money is actually owed. A zero balance stays uncoloured. */
function debtOutstandingClass(amount: number): 'return-neg' | 'history-deduction' | undefined {
  if (amount > 0) return 'return-neg';
  if (amount < 0) return 'history-deduction';
  return undefined;
}

const CLASS_LABELS: Record<string, string> = {
  total: 'Total net worth',
  assets: 'Assets (before debt)',
  cash: 'Cash',
  cashLiabilities: 'Cash liabilities',
  stocks: 'Stocks',
  crypto: 'Crypto',
  gomining: 'GoMining miners',
  art: 'Art',
  metals: 'Metals',
  stones: 'Stones',
  forex: 'Forex',
  kiwiSaver: 'KiwiSaver',
  debt: 'Debt / I owe',
};

const CLASS_ORDER = [
  'total',
  'assets',
  'cash',
  'stocks',
  'crypto',
  'gomining',
  'metals',
  'forex',
  'art',
  'stones',
  'kiwiSaver',
  'cashLiabilities',
  'debt',
];

type YearlyBundle = {
  snapshots: Snapshot[];
  holdings: HoldingRow[];
  debtSummary: {
    outstandingTotalNzd: number;
    personCount: number;
    personKindCount?: number;
    corporationCount?: number;
    repaidTotalNzd: number;
    year: number | null;
    asOf: string;
  } | null;
  debtPeople: Array<{
    id: string;
    name: string;
    kind: 'person' | 'corporation';
    outstandingNzd: number;
    notes: string | null;
  }>;
  debtRepayments: Array<{
    id: string;
    personId: string;
    personName: string | null;
    amountNzd: number;
    date: string;
    notes: string | null;
  }>;
};

function yearlyKey(year: number): string {
  return `yearly:${year}`;
}

export function YearlyReport() {
  const [year, setYear] = useState(DEFAULT_REPORT_YEAR);
  const initialYear = readPageCache<YearlyBundle>(yearlyKey(DEFAULT_REPORT_YEAR));
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initialYear?.snapshots ?? []);
  const [holdings, setHoldings] = useState<HoldingRow[]>(initialYear?.holdings ?? []);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'class' | 'holdings'>('class');
  const [resolution, setResolution] = useState<ChartResolution>('day');
  const [debtSummary, setDebtSummary] = useState<YearlyBundle['debtSummary']>(initialYear?.debtSummary ?? null);
  const [debtPeople, setDebtPeople] = useState<YearlyBundle['debtPeople']>(initialYear?.debtPeople ?? []);
  const [debtRepayments, setDebtRepayments] = useState<YearlyBundle['debtRepayments']>(
    initialYear?.debtRepayments ?? [],
  );
  const [appliedYear, setAppliedYear] = useState(year);
  if (appliedYear !== year) {
    setAppliedYear(year);
    const next = readPageCache<YearlyBundle>(yearlyKey(year));
    if (next) {
      setSnapshots(next.snapshots);
      setHoldings(next.holdings);
      setDebtSummary(next.debtSummary);
      setDebtPeople(next.debtPeople);
      setDebtRepayments(next.debtRepayments);
      setError(null);
    }
  }

  const load = useCallback(async () => {
    const stamp = beginPageRead(yearlyKey(year));
    const [snaps, holds, summary, people, repayments] = await Promise.all([
      api.snapshots.list(year),
      api.holdings.list(),
      api.debts.summary(year).catch(() => null),
      api.debts.people().catch(() => []),
      api.debts.repayments({ year }).catch(() => []),
    ]);
    const peopleRows = (
      people as Array<{
        id: string;
        name: string;
        kind?: 'person' | 'corporation';
        outstandingNzd: number;
        notes: string | null;
      }>
    ).map((p) => ({
      ...p,
      kind: p.kind === 'corporation' ? 'corporation' as const : 'person' as const,
    }));
    const repaymentRows = repayments as YearlyBundle['debtRepayments'];
    const bundle: YearlyBundle = {
      snapshots: snaps as Snapshot[],
      holdings: holds as HoldingRow[],
      debtSummary: summary,
      debtPeople: peopleRows,
      debtRepayments: repaymentRows,
    };
    if (!commitPageRead(stamp, bundle)) return;
    setSnapshots(bundle.snapshots);
    setHoldings(bundle.holdings);
    setDebtSummary(bundle.debtSummary);
    setDebtPeople(bundle.debtPeople);
    setDebtRepayments(bundle.debtRepayments);
    setError(null);
  }, [year]);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  async function onSnapshotNow() {
    setMsg(null);
    setSaving(true);
    try {
      const snap = await api.snapshots.take(`Manual snapshot · ${year} report`);
      setMsg(`Snapshot saved · ${formatNzd(snap.totalNzd)} · ${formatAuckland(snap.takenAt)}`);
      invalidateFinancial('yearly');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const classSeries: LineSeries[] = useMemo(() => {
    const keys = new Set<string>();
    for (const s of snapshots) {
      const bc = s.breakdown?.byClass ?? {};
      for (const [k, v] of Object.entries(bc)) {
        if (v != null && Number.isFinite(Number(v))) keys.add(k);
      }
      // Always include total from row
      if (Number.isFinite(s.totalNzd)) keys.add('total');
    }
    const ordered = [
      ...CLASS_ORDER.filter((k) => keys.has(k)),
      ...[...keys].filter((k) => !CLASS_ORDER.includes(k)).sort(),
    ];
    return ordered.map((key, i) => ({
      key: `class:${key}`,
      label: CLASS_LABELS[key] ?? key,
      colour: seriesColour(i),
      points: snapshots
        .map((s) => {
          const raw =
            key === 'total'
              ? s.totalNzd
              : s.breakdown?.byClass?.[key];
          if (raw == null || !Number.isFinite(Number(raw))) return null;
          return { at: s.takenAt, value: Number(raw) };
        })
        .filter((p): p is { at: string; value: number } => p != null),
    }));
  }, [snapshots]);

  const holdingSeries: LineSeries[] = useMemo(() => {
    const byId = new Map<string, { label: string; points: { at: string; value: number }[] }>();
    for (const s of snapshots) {
      const rows = s.breakdown?.holdings ?? [];
      for (const h of rows) {
        if (h.valueNzd == null || !Number.isFinite(Number(h.valueNzd))) continue;
        const prev = byId.get(h.id) ?? { label: h.label || h.id, points: [] };
        prev.label = h.label || prev.label;
        prev.points.push({ at: s.takenAt, value: Number(h.valueNzd) });
        byId.set(h.id, prev);
      }
    }
    return [...byId.entries()]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([id, row], i) => ({
        key: `hold:${id}`,
        label: row.label,
        colour: seriesColour(i),
        points: row.points,
      }));
  }, [snapshots]);

  const latestInYear = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const firstInYear = snapshots.length ? snapshots[0] : null;
  const growthNzd =
    latestInYear && firstInYear && snapshots.length >= 2
      ? latestInYear.totalNzd - firstInYear.totalNzd
      : null;

  const latestHoldings = latestInYear?.breakdown?.holdings ?? [];

  /** Repayments in selected year, grouped by month (real dates only — never invent). */
  const repaymentsByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of debtRepayments) {
      if (!r.date || !r.date.startsWith(String(year))) continue;
      const ym = r.date.slice(0, 7); // YYYY-MM
      map.set(ym, (map.get(ym) ?? 0) + Number(r.amountNzd || 0));
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, total]) => ({ ym, total }));
  }, [debtRepayments, year]);

  const debtSeries: LineSeries[] = useMemo(() => {
    // Build points from actual repayment dates only (no zero-fill inventing).
    if (debtRepayments.length === 0) return [];
    const byDay = new Map<string, number>();
    for (const r of debtRepayments) {
      if (!r.date || !r.date.startsWith(String(year))) continue;
      byDay.set(r.date, (byDay.get(r.date) ?? 0) + Number(r.amountNzd || 0));
    }
    const dayPoints = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, v]) => ({ at: `${d}T12:00:00+13:00`, value: v }));
    if (dayPoints.length === 0) return [];
    // Cumulative repaid over the year (from recorded repayments only)
    let cum = 0;
    const cumPoints = dayPoints.map((p) => {
      cum += p.value;
      return { at: p.at, value: cum };
    });
    return [
      {
        key: 'debt:repaid-day',
        label: 'Debt repaid (day)',
        colour: seriesColour(0),
        points: dayPoints,
      },
      {
        key: 'debt:repaid-cum',
        label: 'Debt repaid (cumulative)',
        colour: seriesColour(1),
        points: cumPoints,
      },
    ];
  }, [debtRepayments, year]);

  if (error) {
    return (
      <div className="stack history-page">
        <div className="panel warn">
          <h2 className="page-title">History</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack history-page">
      <section className="panel">
        <h2 className="page-title">History</h2>
        <p className="page-lead">
          Net-worth growth and per-asset lines from <strong>valuation_snapshots</strong> only.
          Toggle <strong>by day</strong> / <strong>by month</strong> — empty buckets stay empty{' '}
          (last real snapshot in each bucket). Never invents points. Take a snapshot to start a
          series for {year}.
        </p>
        <div className="period-pager" role="navigation" aria-label="Report year">
          <button
            type="button"
            className="btn"
            aria-label="Previous year"
            onClick={() => setYear((y) => y - 1)}
          >
            ← Prev
          </button>
          <div className="period-pager-label">
            <strong>{year}</strong>
            <span className="muted small">Pacific/Auckland calendar year</span>
          </div>
          <button
            type="button"
            className="btn"
            aria-label="Next year"
            onClick={() => setYear((y) => y + 1)}
          >
            Next →
          </button>
        </div>
        <div className="row gap">
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={onSnapshotNow}
          >
            {saving ? 'Saving…' : 'Snapshot now'}
          </button>
          <div className="chart-toggle" role="group" aria-label="Series view">
            <button
              type="button"
              className={`btn small${view === 'class' ? ' primary' : ''}`}
              aria-pressed={view === 'class'}
              onClick={() => setView('class')}
            >
              By class
            </button>
            <button
              type="button"
              className={`btn small${view === 'holdings' ? ' primary' : ''}`}
              aria-pressed={view === 'holdings'}
              onClick={() => setView('holdings')}
            >
              Per holding
            </button>
          </div>
          <div className="chart-toggle" role="group" aria-label="Chart resolution">
            <button
              type="button"
              className={`btn small${resolution === 'day' ? ' primary' : ''}`}
              aria-pressed={resolution === 'day'}
              onClick={() => setResolution('day')}
            >
              By day
            </button>
            <button
              type="button"
              className={`btn small${resolution === 'month' ? ' primary' : ''}`}
              aria-pressed={resolution === 'month'}
              onClick={() => setResolution('month')}
            >
              By month
            </button>
          </div>
        </div>
        {msg && <div className="banner">{msg}</div>}
      </section>

      <section className="panel">
        <h3>Net worth · {year}</h3>
        {snapshots.length === 0 ? (
          <p className="muted">
            No snapshots in {year} yet. Use <strong>Snapshot now</strong> to record current known
            balances. Growth fills as more snapshots are taken — price_quotes are current-only and
            are not used as a fake history.
          </p>
        ) : (
          <>
            <div className="grid cards">
              <div className="card">
                <p className="eyebrow">Snapshots</p>
                <p className="stat-value">
                  {snapshots.length}
                </p>
              </div>
              <div className="card">
                <p className="eyebrow">Latest in year</p>
                <p className={'stat-value' + (latestInYear!.totalNzd < 0 ? ' return-neg' : '')}>
                  {formatNzd(latestInYear!.totalNzd)}
                </p>
                <p className="muted small">{formatAuckland(latestInYear!.takenAt)}</p>
              </div>
              <div className="card">
                <p className="eyebrow">Change (first → last)</p>
                <p
                  className={
                    'stat-value' +
                    (growthNzd == null || growthNzd === 0
                      ? ''
                      : growthNzd < 0
                        ? ' return-neg'
                        : ' return-pos')
                  }
                >
                  {growthNzd == null ? '—' : formatNzd(growthNzd)}
                </p>
                <p className="muted small">
                  {snapshots.length < 2
                    ? 'Need ≥2 snapshots for growth'
                    : `${formatAuckland(firstInYear!.takenAt)} → ${formatAuckland(latestInYear!.takenAt)}`}
                </p>
              </div>
            </div>
            <AssetLineChart
              title={
                view === 'class'
                  ? `Asset class lines · ${year} · ${resolution === 'day' ? 'by day' : 'by month'}`
                  : `Per-holding lines · ${year} · ${resolution === 'day' ? 'by day' : 'by month'}`
              }
              series={view === 'class' ? classSeries : holdingSeries}
              resolution={resolution}
              emptyHint={
                view === 'class'
                  ? 'Snapshots exist but have no class breakdown yet.'
                  : 'Snapshots exist but have no per-holding breakdown yet. Take a new snapshot to capture holdings.'
              }
            />
          </>
        )}
      </section>


      <section className="panel">
        <h3>Debt · {year}</h3>
        <p className="muted small">
          Current outstanding from live debt balances (not invented). Year repaid from recorded
          repayment history dated in {year}. New snapshots store debt outstanding in breakdown{' '}
          (class key <code>debt</code>) so net worth lines already subtract liabilities; day/month
          repayment series below still use repayment dates only.
        </p>
        <div className="grid cards">
          <div className="card">
            <p className="eyebrow">Outstanding now</p>
            <p
              className={
                [
                  'stat-value',
                  debtSummary != null
                    ? debtOutstandingClass(debtSummary.outstandingTotalNzd)
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(' ')
              }
            >
              {debtSummary != null ? formatNzd(debtSummary.outstandingTotalNzd) : '—'}
            </p>
            <p className="muted small">
              {debtSummary != null
                ? `${debtSummary.personCount} creditor${debtSummary.personCount === 1 ? '' : 's'}` +
                  (debtSummary.corporationCount
                    ? ` · ${debtSummary.personKindCount ?? 0} person · ${debtSummary.corporationCount} corp`
                    : '') +
                  ' · live balances'
                : 'No debt data'}
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Repaid in {year}</p>
            <p className="stat-value">
              {debtSummary != null ? formatNzd(debtSummary.repaidTotalNzd) : '—'}
            </p>
            <p className="muted small">
              {debtRepayments.length} repayment{debtRepayments.length === 1 ? '' : 's'} recorded
            </p>
          </div>
        </div>
        {debtPeople.length > 0 && (
          <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Who</th>
                  <th>Outstanding (NZD)</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {debtPeople
                  .slice()
                  .sort((a, b) => b.outstandingNzd - a.outstandingNzd)
                  .map((p) => (
                    <tr key={p.id}>
                      <td className="muted small">
                        {p.kind === 'corporation' ? 'Corporation' : 'Person'}
                      </td>
                      <td>{p.name}</td>
                      <td className={debtOutstandingClass(p.outstandingNzd)}>
                        {formatNzd(p.outstandingNzd)}
                      </td>
                      <td className="muted small">{p.notes || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {repaymentsByMonth.length > 0 && (
          <>
            <h4 style={{ margin: '1rem 0 0.35rem' }}>Repaid by month · {year}</h4>
            <ul className="plain-list">
              {repaymentsByMonth.map((m) => (
                <li key={m.ym}>
                  {m.ym} · {formatNzd(m.total)}
                </li>
              ))}
            </ul>
          </>
        )}
        {debtSeries.length > 0 && (
          <AssetLineChart
            title={`Debt repaid · ${year} · by day (recorded repayments only)`}
            series={debtSeries}
            resolution={resolution}
            emptyHint="No repayments in this year."
          />
        )}
        {debtRepayments.length > 0 && (
          <>
            <h4 style={{ margin: '1rem 0 0.35rem' }}>Repayment log · {year}</h4>
            <ul className="plain-list">
              {debtRepayments
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((r) => (
                  <li key={r.id}>
                    {r.date} · {formatNzd(r.amountNzd)} → {r.personName ?? r.personId}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </li>
                ))}
            </ul>
          </>
        )}
        {debtSummary != null &&
          debtSummary.personCount === 0 &&
          debtRepayments.length === 0 && (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              No debt creditors or repayments yet. Add them under <Link to="/debts">Debts</Link>.
            </p>
          )}
      </section>

      <section className="panel">
        <h3>Holdings summary · {year}</h3>
        {latestHoldings.length > 0 ? (
          <>
            <p className="muted small">
              From latest snapshot in {year} ({formatAuckland(latestInYear!.takenAt)}). Not
              invented.
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Holding</th>
                    <th>Class</th>
                    <th>Value (NZD)</th>
                  </tr>
                </thead>
                <tbody>
                  {latestHoldings
                    .slice()
                    .sort((a, b) => b.valueNzd - a.valueNzd)
                    .map((h) => (
                      <tr key={h.id}>
                        <td>{h.label}</td>
                        <td>{h.assetClass}</td>
                        <td className={h.valueNzd < 0 ? 'return-neg' : undefined}>
                          {formatNzd(h.valueNzd)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        ) : snapshots.length > 0 ? (
          <p className="muted">
            Latest {year} snapshot has no per-holding breakdown. Take a new snapshot (this build
            stores holdings in breakdown_json).
          </p>
        ) : holdings.length > 0 ? (
          <>
            <p className="muted small">
              No snapshot in {year} — showing <strong>live</strong> holdings list (names only;
              values appear after you snapshot).
            </p>
            <ul className="plain-list">
              {holdings.map((h) => (
                <li key={h.id}>
                  {h.name || h.symbol || h.asset || h.id}
                  {h.assetClass ? ` · ${h.assetClass}` : ''}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">No holdings and no snapshots yet.</p>
        )}
      </section>

      {snapshots.length > 0 && (
        <section className="panel">
          <h3>Snapshot log · {year}</h3>
          <ul className="plain-list">
            {snapshots.map((s) => (
              <li key={s.id}>
                {formatAuckland(s.takenAt)} ·{' '}
                <span className={s.totalNzd < 0 ? 'return-neg' : undefined}>
                  {formatNzd(s.totalNzd)}
                </span>
                {s.notes ? ` · ${s.notes}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
