/**
 * Yearly report — net-worth / holdings growth from valuation_snapshots.
 * Line graph per asset (class + holding series). Never invents balances.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatAuckland, formatNzd } from '../api/client';
import { beginPageRead, commitPageRead, invalidateFinancial, readPageCache } from '../lib/pageDataCache';
import { seriesColour, type ChartResolution, type LineSeries } from '../components/AssetLineChart';
import { DEFAULT_REPORT_YEAR } from '../lib/period';
import {
  adjacentYears,
  chartClassKeys,
  classLabel,
  costValuedSoldFlags,
  holdingOrder,
  type SnapshotHolding,
  snapshotYears,
  TOP_HOLDINGS,
  yearHeadline,
} from '../lib/historyView';
import { HistoryHeader } from '../components/history/HistoryHeader';
import { HistoryHeadline } from '../components/history/HistoryHeadline';
import { HistoryChart } from '../components/history/HistoryChart';
import { HistoryLatest } from '../components/history/HistoryLatest';
import { HistoryDebtLink } from '../components/history/HistoryDebtLink';
import { HistoryDailySwitch } from '../components/history/HistoryDailySwitch';

type SnapshotBreakdown = {
  byClass?: Record<string, number | null>;
  holdings?: SnapshotHolding[];
  asOf?: string;
  quoteNote?: string;
};

type Snapshot = {
  id: string;
  takenAt: string;
  totalNzd: number;
  breakdown: SnapshotBreakdown;
};

type HoldingRow = {
  id: string;
  assetClass?: string;
  shares?: number | null;
  amount?: number | null;
  costBasisNzd?: number | null;
};

type ChartView = 'net' | 'class' | 'holdings';

const VIEW_LABELS: Record<ChartView, string> = { net: 'Net worth', class: 'By class', holdings: 'Per holding' };
const RESOLUTION_LABELS: Record<ChartResolution, string> = { day: 'Day', month: 'Month' };

type YearlyBundle = {
  snapshots: Snapshot[];
  /** Auckland years that have any snapshot, from the unfiltered list. */
  snapshotYears: number[];
  holdings: HoldingRow[];
  debtSummary: {
    outstandingTotalNzd: number;
    personCount: number;
    repaidTotalNzd: number;
  } | null;
};

function yearlyKey(year: number): string {
  return `yearly:${year}`;
}

export function YearlyReport() {
  const [year, setYear] = useState(DEFAULT_REPORT_YEAR);
  const initialYear = readPageCache<YearlyBundle>(yearlyKey(DEFAULT_REPORT_YEAR));
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initialYear?.snapshots ?? []);
  const [years, setYears] = useState<number[]>(initialYear?.snapshotYears ?? []);
  const [holdings, setHoldings] = useState<HoldingRow[]>(initialYear?.holdings ?? []);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<ChartView>('net');
  const [showAllHoldings, setShowAllHoldings] = useState(false);
  const [resolution, setResolution] = useState<ChartResolution>('day');
  const [debtSummary, setDebtSummary] = useState<YearlyBundle['debtSummary']>(initialYear?.debtSummary ?? null);
  const [appliedYear, setAppliedYear] = useState(year);
  if (appliedYear !== year) {
    setAppliedYear(year);
    setShowAllHoldings(false);
    const next = readPageCache<YearlyBundle>(yearlyKey(year));
    if (next) {
      setSnapshots(next.snapshots);
      setYears(next.snapshotYears);
      setHoldings(next.holdings);
      setDebtSummary(next.debtSummary);
      setError(null);
    }
  }

  const load = useCallback(async () => {
    const stamp = beginPageRead(yearlyKey(year));
    const [snaps, allSnaps, holds, summary] = await Promise.all([
      api.snapshots.list(year),
      api.snapshots.list(),
      api.holdings.list(),
      api.debts.summary(year).catch(() => null),
    ]);
    const bundle: YearlyBundle = {
      snapshots: snaps as Snapshot[],
      snapshotYears: snapshotYears(allSnaps),
      holdings: holds as HoldingRow[],
      debtSummary: summary,
    };
    if (!commitPageRead(stamp, bundle)) return;
    setSnapshots(bundle.snapshots);
    setYears(bundle.snapshotYears);
    setHoldings(bundle.holdings);
    setDebtSummary(bundle.debtSummary);
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

  const netSeries: LineSeries[] = useMemo(
    () => [
      {
        key: 'net',
        label: 'Net worth',
        colour: seriesColour(0),
        points: snapshots
          .filter((s) => Number.isFinite(s.totalNzd))
          .map((s) => ({ at: s.takenAt, value: s.totalNzd, takenAt: s.takenAt })),
      },
    ],
    [snapshots],
  );

  const classSeries: LineSeries[] = useMemo(
    () =>
      chartClassKeys(snapshots).map((key, i) => ({
        key: `class:${key}`,
        label: classLabel(key),
        colour: seriesColour(i),
        points: snapshots.flatMap((s) => {
          const raw = s.breakdown?.byClass?.[key];
          return raw != null && Number.isFinite(Number(raw)) ? [{ at: s.takenAt, value: Number(raw), takenAt: s.takenAt }] : [];
        }),
      })),
    [snapshots],
  );

  const holdingSeries: LineSeries[] = useMemo(() => {
    const byId = new Map<string, { label: string; points: LineSeries['points'] }>();
    for (const s of snapshots) {
      for (const h of s.breakdown?.holdings ?? []) {
        if (h.valueNzd == null || !Number.isFinite(Number(h.valueNzd))) continue;
        const row = byId.get(h.id) ?? { label: h.label || h.id, points: [] };
        row.label = h.label || row.label;
        row.points.push({ at: s.takenAt, value: Number(h.valueNzd), takenAt: s.takenAt });
        byId.set(h.id, row);
      }
    }
    return holdingOrder(snapshots).flatMap((id, i) => {
      const row = byId.get(id);
      return row ? [{ key: `hold:${id}`, label: row.label, colour: seriesColour(i), points: row.points }] : [];
    });
  }, [snapshots]);

  const soldFlags = useMemo(() => costValuedSoldFlags(snapshots, holdings), [snapshots, holdings]);

  const headline = yearHeadline(snapshots);
  const latestInYear = headline?.latest ?? null;
  const { prev: prevYear, next: nextYear } = adjacentYears(years, year);

  const latestHoldings = latestInYear?.breakdown?.holdings ?? [];
  const latestFlags = latestInYear ? (soldFlags.get(latestInYear.takenAt) ?? []) : [];
  const classColour = (classKey: string) => classSeries.find((s) => s.key === `class:${classKey}`)?.colour;
  const debt =
    debtSummary != null &&
    (debtSummary.personCount > 0 || debtSummary.outstandingTotalNzd !== 0 || debtSummary.repaidTotalNzd !== 0)
      ? debtSummary
      : null;

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
      <HistoryHeader
        year={year}
        snapshotCount={snapshots.length}
        prevYear={prevYear}
        nextYear={nextYear}
        onSelectYear={setYear}
        saving={saving}
        onSnapshotNow={onSnapshotNow}
      />
      {msg && <div className="banner" role="status">{msg}</div>}

      {headline ? (
        <HistoryHeadline headline={headline}>
          <div className="history-chart-head">
            <div className="segmented" role="group" aria-label="Chart view">
              {(Object.keys(VIEW_LABELS) as ChartView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={'segmented-btn' + (view === v ? ' active' : '')}
                  aria-pressed={view === v}
                  onClick={() => {
                    setView(v);
                    setShowAllHoldings(false);
                  }}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
            <div className="segmented segmented--small" role="group" aria-label="Group snapshots by">
              {(Object.keys(RESOLUTION_LABELS) as ChartResolution[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={'segmented-btn' + (resolution === r ? ' active' : '')}
                  aria-pressed={resolution === r}
                  onClick={() => setResolution(r)}
                >
                  {RESOLUTION_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
          <HistoryChart
            key={`${view}:${year}`}
            series={
              view === 'net'
                ? netSeries
                : view === 'class'
                  ? classSeries
                  : showAllHoldings
                    ? holdingSeries
                    : holdingSeries.slice(0, TOP_HOLDINGS)
            }
            resolution={resolution}
            flags={soldFlags}
            snapshotCount={snapshots.length}
            label={`${VIEW_LABELS[view]} in ${year}, ${resolution === 'day' ? 'last snapshot each day' : 'last snapshot each month'}`}
            legend={view !== 'net'}
            emptyHint={
              view === 'holdings'
                ? 'These snapshots have no per-holding breakdown. New snapshots record each holding.'
                : 'These snapshots have no values to plot for this view.'
            }
            legendExtra={
              view === 'holdings' && holdingSeries.length > TOP_HOLDINGS ? (
                <button
                  type="button"
                  className="btn small history-chart-more"
                  aria-expanded={showAllHoldings}
                  onClick={() => setShowAllHoldings((v) => !v)}
                >
                  {showAllHoldings ? `Show top ${TOP_HOLDINGS}` : `Show all (${holdingSeries.length})`}
                </button>
              ) : null
            }
          />
        </HistoryHeadline>
      ) : (
        <section className="panel">
          <p className="muted">
            No snapshots in {year} yet. Use <strong>Snapshot now</strong> to start the year.
          </p>
        </section>
      )}

      {/* With no snapshot this year, the empty state above already says so. */}
      {latestInYear ? (
        <HistoryLatest
          takenAt={latestInYear.takenAt}
          holdings={latestHoldings}
          classColour={classColour}
          flags={latestFlags}
        />
      ) : null}

      {debt ? (
        <HistoryDebtLink year={year} outstandingNzd={debt.outstandingTotalNzd} repaidNzd={debt.repaidTotalNzd} />
      ) : null}

      <HistoryDailySwitch />
    </div>
  );
}
