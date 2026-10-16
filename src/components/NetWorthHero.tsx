/**
 * Dashboard net worth hero: Total / Accessible toggle (remembered), daily-snapshot
 * sparkline with 1M / 6M / 1Y / All ranges, and the change over the range.
 * Accessible = total − KiwiSaver. Fewer than 2 days of history shows an empty state.
 */
import { useState, type ReactNode } from 'react';
import { formatNzd } from '../api/client';
import { useMoneyHidden } from '../lib/privacy';
import {
  accessibleOf,
  aucklandDate,
  dailySeries,
  HISTORY_RANGES,
  historyDelta,
  pointsInRange,
  readNetWorthView,
  saveNetWorthView,
  shortDate,
  type HistoryPoint,
  type HistoryRange,
  type NetWorthView,
  type SnapshotLike,
} from '../lib/netWorthHistory';
import { InfoTip } from './InfoTip';

const VIEW_LABELS: Record<NetWorthView, string> = { total: 'Total', accessible: 'Accessible' };

export function NetWorthHero({
  totalNzd,
  kiwiSaverNzd,
  assetsNzd,
  debtNzd,
  snapshots,
  info,
  hiddenNote = null,
}: {
  totalNzd: number;
  kiwiSaverNzd: number | null;
  assetsNzd: number | null;
  debtNzd: number;
  /** Null while history is loading or could not be read. */
  snapshots: SnapshotLike[] | null;
  info: ReactNode;
  /** "Leaves out Property ($240,000.00), hidden in Settings …" when classes are hidden. */
  hiddenNote?: string | null;
}) {
  const [view, setView] = useState<NetWorthView>(() => readNetWorthView());
  const [range, setRange] = useState<HistoryRange>('1M');
  const moneyHidden = useMoneyHidden();
  // Ranges count back from the day the page opened.
  const [today] = useState(() => aucklandDate(new Date().toISOString()) ?? '');

  const choose = (next: NetWorthView) => {
    setView(next);
    saveNetWorthView(next);
  };

  const value = view === 'total' ? totalNzd : accessibleOf(totalNzd, kiwiSaverNzd);
  const series = snapshots ? dailySeries(snapshots, view) : [];
  const points = pointsInRange(series, range, today);
  const delta = historyDelta(points, range, today);

  return (
    <section className="hero-card net-worth-hero" aria-labelledby="net-worth-heading">
      <div className="net-worth-hero-top">
        <h2 id="net-worth-heading" className="eyebrow page-title">
          Net worth
          <InfoTip label="About net worth">{info}</InfoTip>
        </h2>
        <div className="segmented" role="group" aria-label="Net worth view">
          {(Object.keys(VIEW_LABELS) as NetWorthView[]).map((v) => (
            <button
              key={v}
              type="button"
              className={'segmented-btn' + (view === v ? ' active' : '')}
              aria-pressed={view === v}
              onClick={() => choose(v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>
      <p className="hero-value">{formatNzd(value)}</p>
      <p className="muted small hero-sub">
        {view === 'accessible'
          ? kiwiSaverNzd != null
            ? `Excludes KiwiSaver ${formatNzd(kiwiSaverNzd)}`
            : 'No KiwiSaver in your total, so this matches it'
          : assetsNzd != null
            ? `Assets ${formatNzd(assetsNzd)}${debtNzd > 0 ? ` − Debt ${formatNzd(debtNzd)}` : ''}`
            : null}
      </p>
      {hiddenNote ? <p className="muted small hero-sub net-worth-hidden">{hiddenNote}</p> : null}

      <div className="net-worth-history">
        {snapshots == null ? null : points.length < 2 ? (
          <p className="muted small net-worth-history-empty">
            {series.length < 2
              ? 'History builds up each day you open the dashboard. The trend appears once there are two days of snapshots.'
              : 'Not enough snapshots in this range yet. Try a longer range.'}
          </p>
        ) : (
          <>
            {delta ? <DeltaLine amount={delta.amount} phrase={delta.phrase} /> : null}
            {moneyHidden ? (
              <p className="muted small net-worth-history-empty">Trend hidden while amounts are hidden.</p>
            ) : (
              <Sparkline points={points} />
            )}
          </>
        )}
        {series.length >= 2 ? (
          <div className="segmented segmented--small" role="group" aria-label="History range">
            {HISTORY_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={'segmented-btn' + (range === r ? ' active' : '')}
                aria-pressed={range === r}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DeltaLine({ amount, phrase }: { amount: number; phrase: string }) {
  const dir = amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  return (
    <p className={`net-worth-delta net-worth-delta--${dir}`}>
      <span aria-hidden="true">{arrow} </span>
      <span className="sr-only">{dir === 'up' ? 'Up ' : dir === 'down' ? 'Down ' : 'No change, '}</span>
      {formatNzd(Math.abs(amount))} {phrase}
    </p>
  );
}

function Sparkline({ points }: { points: HistoryPoint[] }) {
  const w = 600;
  const h = 64;
  const pad = 3;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => (max === min ? h / 2 : pad + (1 - (v - min) / span) * (h - pad * 2));
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <svg
      className="net-worth-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Net worth from ${formatNzd(first.value)} on ${shortDate(first.date)} to ${formatNzd(last.value)} on ${shortDate(last.date)}, ${points.length} days`}
    >
      <polygon className="net-worth-sparkline-area" points={`${x(0)},${h} ${line} ${x(points.length - 1)},${h}`} />
      <polyline className="net-worth-sparkline-line" points={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
