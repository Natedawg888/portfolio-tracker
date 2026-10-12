/**
 * History line chart: one line per series from real snapshots only, bucketed by
 * Auckland day or month (last real snapshot wins). Each point is focusable and
 * shows that snapshot's own time and exact value on hover, focus or tap.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatAuckland, formatNzd } from '../../api/client';
import { axisLabel, compactNzd, monthLabel, parseAt } from '../../lib/chartAxis';
import {
  computeYDomain,
  computeYTicks,
  resampleSeries,
  type ChartResolution,
  type LinePoint,
  type LineSeries,
} from '../AssetLineChart';
import {
  bucketCount,
  costValuedSoldSentence,
  flagsForSeries,
  type CostValuedSold,
} from '../../lib/historyView';
import { useMoneyHidden } from '../../lib/privacy';

type Active = { key: string; index: number; pinned: boolean };

const WIDTH = 640;
const PAD = { l: 52, r: 14, t: 18, b: 28 };

export function HistoryChart({
  series,
  resolution,
  flags,
  snapshotCount,
  label,
  legend,
  legendExtra,
  emptyHint,
}: {
  /** Every series for this view, colours already assigned, so hiding one never recolours another. */
  series: LineSeries[];
  resolution: ChartResolution;
  /** Cost-valued sold holdings per snapshot takenAt. */
  flags: Map<string, CostValuedSold[]>;
  snapshotCount: number;
  label: string;
  legend: boolean;
  legendExtra?: ReactNode;
  emptyHint: string;
}) {
  useMoneyHidden();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<Active | null>(null);
  const [rove, setRove] = useState<Record<string, number>>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointRefs = useRef(new Map<string, SVGGElement>());

  const pinned = active?.pinned ?? false;
  useEffect(() => {
    if (!pinned) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinned]);

  const resampled = resampleSeries(series, resolution).filter((s) => s.points.length > 0);
  const buckets = bucketCount(resampled);

  if (buckets === 0) {
    return <p className="muted small history-chart-note">{emptyHint}</p>;
  }
  if (buckets === 1) {
    return <p className="muted small history-chart-note">{singleBucketMessage(series, resolution, snapshotCount)}</p>;
  }

  const visible = resampled.filter((s) => !hidden.has(s.key));
  const pointFlags = (key: string, p: LinePoint) => flagsForSeries(key, (p.takenAt && flags.get(p.takenAt)) || []);
  const flaggedVisible = visible.some((s) => s.points.some((p) => pointFlags(s.key, p).length > 0));

  const allPoints = visible.flatMap((s) => s.points);
  const fewPoints = buckets <= 3;
  const chartH = fewPoints ? 200 : 260;
  const plotW = WIDTH - PAD.l - PAD.r;
  const plotH = chartH - PAD.t - PAD.b;
  const times = allPoints.map((p) => parseAt(p.at));
  const tMin = Math.min(...times);
  const tSpan = Math.max(Math.max(...times) - tMin, 1);
  const { vMin, vMax } = computeYDomain(allPoints.map((p) => p.value));
  const vSpan = vMax - vMin;
  const xOf = (at: string) => PAD.l + ((parseAt(at) - tMin) / tSpan) * plotW;
  const yOf = (v: number) => (vSpan > 0 ? PAD.t + (1 - (v - vMin) / vSpan) * plotH : PAD.t + plotH / 2);

  const uniqueTimes = [...new Set(allPoints.map((p) => p.at))].sort((a, b) => parseAt(a) - parseAt(b));
  const tickStep = Math.max(1, Math.ceil(uniqueTimes.length / 6));
  const xTicks = uniqueTimes.filter((_, i) => i % tickStep === 0 || i === uniqueTimes.length - 1);

  const describe = (s: LineSeries, p: LinePoint) => {
    const f = pointFlags(s.key, p);
    const when = p.takenAt ? formatAuckland(p.takenAt) : bucketLabel(p.at, resolution);
    return {
      when,
      value: formatNzd(p.value),
      flag: f.length > 0 ? costValuedSoldSentence(f, formatNzd) : null,
    };
  };

  function focusPoint(key: string, index: number) {
    setRove((r) => ({ ...r, [key]: index }));
    pointRefs.current.get(`${key}|${index}`)?.focus();
  }

  function onPointKey(event: KeyboardEvent, s: LineSeries, index: number) {
    const last = s.points.length - 1;
    const target =
      event.key === 'ArrowRight' ? Math.min(index + 1, last)
      : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (target == null) return;
    event.preventDefault();
    focusPoint(s.key, target);
  }

  const activeSeries = active ? visible.find((s) => s.key === active.key) : undefined;
  const activePoint = activeSeries?.points[active!.index];
  const tip = activeSeries && activePoint ? describe(activeSeries, activePoint) : null;

  return (
    <div
      ref={wrapRef}
      className="history-chart"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && active) {
          event.stopPropagation();
          setActive(null);
        }
      }}
    >
      {visible.length === 0 ? (
        <p className="muted small history-chart-note">All lines are hidden. Turn one back on below.</p>
      ) : (
        <div className="history-chart-plot">
          <svg className="line-chart-svg" viewBox={`0 0 ${WIDTH} ${chartH}`} role="group" aria-label={label}>
            {computeYTicks(vMin, vMax).map((v, i) => (
              <g key={`y-${i}`} aria-hidden="true">
                <line x1={PAD.l} x2={WIDTH - PAD.r} y1={yOf(v)} y2={yOf(v)} className="line-chart-grid" />
                <text x={PAD.l - 6} y={yOf(v)} textAnchor="end" dominantBaseline="middle" className="line-chart-axis">
                  {compactNzd(v)}
                </text>
              </g>
            ))}
            {xTicks.map((at, i) => (
              <text
                key={at}
                aria-hidden="true"
                x={xOf(at)}
                y={chartH - 8}
                textAnchor={i === xTicks.length - 1 && xTicks.length > 1 ? 'end' : 'middle'}
                className="line-chart-axis"
              >
                {bucketLabel(at, resolution)}
              </text>
            ))}
            {activePoint ? (
              <line
                aria-hidden="true"
                x1={xOf(activePoint.at)}
                x2={xOf(activePoint.at)}
                y1={PAD.t}
                y2={PAD.t + plotH}
                className="econ-chart-cross"
              />
            ) : null}
            {visible.map((s) => {
              const roveIndex = Math.min(rove[s.key] ?? s.points.length - 1, s.points.length - 1);
              return (
                <g key={s.key} role="group" aria-label={`${s.label}, ${s.points.length} points`}>
                  {s.points.length > 1 ? (
                    <path
                      aria-hidden="true"
                      d={s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.at)} ${yOf(p.value)}`).join(' ')}
                      fill="none"
                      stroke={s.colour}
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {s.points.map((p, i) => {
                    const d = describe(s, p);
                    const isActive = active?.key === s.key && active.index === i;
                    const x = xOf(p.at);
                    const y = yOf(p.value);
                    return (
                      <g
                        key={p.at}
                        ref={(el) => {
                          if (el) pointRefs.current.set(`${s.key}|${i}`, el);
                          else pointRefs.current.delete(`${s.key}|${i}`);
                        }}
                        className="history-chart-point"
                        role="img"
                        tabIndex={i === roveIndex ? 0 : -1}
                        aria-label={`${s.label}, ${d.when}: ${d.value}.${d.flag ? ` Warning: ${d.flag}` : ''}`}
                        onFocus={() => {
                          setRove((r) => ({ ...r, [s.key]: i }));
                          setActive((a) => (a?.pinned && a.key === s.key && a.index === i ? a : { key: s.key, index: i, pinned: false }));
                        }}
                        onBlur={() => setActive((a) => (a?.pinned ? a : null))}
                        onPointerEnter={(event) => {
                          if (event.pointerType === 'mouse') setActive((a) => (a?.pinned ? a : { key: s.key, index: i, pinned: false }));
                        }}
                        onPointerLeave={(event) => {
                          if (event.pointerType === 'mouse') setActive((a) => (a?.pinned ? a : null));
                        }}
                        onClick={() =>
                          setActive((a) => (a?.pinned && a.key === s.key && a.index === i ? null : { key: s.key, index: i, pinned: true }))
                        }
                        onKeyDown={(event) => onPointKey(event, s, i)}
                      >
                        <circle cx={x} cy={y} r={11} className="history-chart-hit" />
                        <circle cx={x} cy={y} r={isActive ? 5 : 3.5} fill={s.colour} className="history-chart-dot" />
                        {d.flag ? (
                          <>
                            <circle cx={x} cy={y} r={7.5} className="history-chart-flag-ring" />
                            <text x={x} y={y - 11} textAnchor="middle" className="history-chart-flag-glyph">
                              !
                            </text>
                          </>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
          {tip && activePoint ? (
            <div
              className={
                'history-chart-tip' +
                (xOf(activePoint.at) / WIDTH < 0.3 ? ' history-chart-tip--start' : xOf(activePoint.at) / WIDTH > 0.7 ? ' history-chart-tip--end' : '') +
                (yOf(activePoint.value) / chartH < 0.4 ? ' history-chart-tip--below' : '')
              }
              style={{
                left: `${(xOf(activePoint.at) / WIDTH) * 100}%`,
                top: `${(yOf(activePoint.value) / chartH) * 100}%`,
              }}
              aria-hidden="true"
            >
              {legend ? <span className="history-chart-tip-series">{activeSeries!.label}</span> : null}
              <strong>{tip.value}</strong>
              <span className="muted">{tip.when}</span>
              {tip.flag ? <span className="history-chart-tip-flag">⚠ {tip.flag}</span> : null}
            </div>
          ) : null}
        </div>
      )}
      {flaggedVisible ? (
        <p className="small history-chart-flag-note">
          ⚠ {flags.size} of {snapshotCount} snapshot{snapshotCount === 1 ? '' : 's'} include a sold holding valued at cost
          (marked !).
        </p>
      ) : null}
      {legend ? (
        <div className="history-chart-legend-row">
          <ul className="history-chart-legend" aria-label="Show or hide lines">
            {resampled.map((s) => {
              const shown = !hidden.has(s.key);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    className={'history-legend-btn' + (shown ? '' : ' history-legend-btn--off')}
                    aria-pressed={shown}
                    onClick={() =>
                      setHidden((h) => {
                        const next = new Set(h);
                        if (shown) next.add(s.key);
                        else next.delete(s.key);
                        return next;
                      })
                    }
                  >
                    <span className="spend-swatch" style={{ background: s.colour }} aria-hidden="true" />
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
          {legendExtra}
        </div>
      ) : null}
    </div>
  );
}

function bucketLabel(at: string, resolution: ChartResolution): string {
  return resolution === 'month' ? monthLabel(at, 'short') : axisLabel(at, 'day');
}

function singleBucketMessage(series: LineSeries[], resolution: ChartResolution, snapshotCount: number): string {
  const oneDay = resolution === 'day' || bucketCount(resampleSeries(series, 'day')) <= 1;
  if (oneDay) return 'Only one day of snapshots so far. The line starts once there is a second day.';
  const at = resampleSeries(series, 'month').find((s) => s.points.length > 0)!.points[0].at;
  return `All ${snapshotCount} snapshots fall in ${monthLabel(at, 'long')}. Switch to Day to see them, or check back next month.`;
}
