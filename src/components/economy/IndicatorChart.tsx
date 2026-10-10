import { useState } from 'react';
import { formatReading, shortPeriod } from '../../lib/economyView';

type Point = { period: string; value: number };

/** Compact trend line from stored observations. Draws nothing for fewer than two points. */
export function Sparkline({ points, label }: { points: Point[]; label: string }) {
  if (points.length < 2) return <p className="muted tiny econ-spark-empty">Not enough history for a trend</p>;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 120;
  const h = 32;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (w - 6) + 3;
    const y = h - 3 - ((p.value - min) / span) * (h - 6);
    return [x, y] as const;
  });
  const last = coords.at(-1)!;
  return (
    <svg
      className="econ-spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${points.length} readings from ${shortPeriod(points[0]!.period)} to ${shortPeriod(points.at(-1)!.period)}, low ${min.toFixed(1)}, high ${max.toFixed(1)}`}
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="currentColor" />
    </svg>
  );
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/**
 * Detail chart: one series, labelled axes, the model's low/high lines, and a
 * hover / focus readout. A table of the same values sits next to it.
 */
export function IndicatorChart({
  points,
  unit,
  label,
  thresholds,
}: {
  points: Point[];
  unit: string | null;
  label: string;
  thresholds: { lowBelow: number; highAbove: number };
}) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return <p className="muted small">Fewer than two stored readings, so no chart is drawn.</p>;

  const values = points.map((p) => p.value);
  const lo = Math.min(...values, thresholds.lowBelow);
  const hi = Math.max(...values, thresholds.highAbove);
  const ticks = niceTicks(lo, hi);
  const yMin = Math.min(ticks[0]!, lo);
  const yMax = Math.max(ticks.at(-1)!, hi);
  const w = 560;
  const h = 200;
  const left = 44;
  const right = 12;
  const top = 12;
  const bottom = 28;
  const pw = w - left - right;
  const ph = h - top - bottom;
  const x = (i: number) => left + (i / (points.length - 1)) * pw;
  const y = (v: number) => top + (1 - (v - yMin) / (yMax - yMin || 1)) * ph;
  const unitShort = unit === 'percent' ? '%' : unit === 'percentage points' ? ' pp' : '';
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));
  const shown = active ?? points.length - 1;
  const activePoint = points[shown]!;

  return (
    <figure className="econ-chart">
      <figcaption className="econ-chart-readout" aria-live="polite">
        <strong>{formatReading(activePoint.value, unit)}</strong>{' '}
        <span className="muted">{shortPeriod(activePoint.period)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${label} history, ${points.length} readings. Values are listed in the table below.`}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} className="econ-chart-grid" />
            <text x={left - 6} y={y(t) + 3.5} textAnchor="end" className="econ-chart-axis">
              {t}
              {unitShort.trim()}
            </text>
          </g>
        ))}
        <line x1={left} x2={w - right} y1={y(thresholds.lowBelow)} y2={y(thresholds.lowBelow)} className="econ-chart-threshold" />
        <line x1={left} x2={w - right} y1={y(thresholds.highAbove)} y2={y(thresholds.highAbove)} className="econ-chart-threshold" />
        <text x={left + 4} y={y(thresholds.highAbove) - 4} textAnchor="start" className="econ-chart-axis">
          high band
        </text>
        <text x={left + 4} y={y(thresholds.lowBelow) + 12} textAnchor="start" className="econ-chart-axis">
          low band
        </text>
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          className="econ-chart-line"
          points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
        />
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.period} x={x(i)} y={h - 8} textAnchor={i === points.length - 1 ? 'end' : 'middle'} className="econ-chart-axis">
              {shortPeriod(p.period).replace(' qtr', '')}
            </text>
          ) : null,
        )}
        {active != null ? <line x1={x(active)} x2={x(active)} y1={top} y2={top + ph} className="econ-chart-cross" /> : null}
        <circle cx={x(shown)} cy={y(activePoint.value)} r="4.5" className="econ-chart-dot" />
        {points.map((p, i) => (
          <rect
            key={`hit-${p.period}`}
            x={x(i) - pw / (points.length - 1) / 2}
            y={top}
            width={pw / (points.length - 1)}
            height={ph}
            fill="transparent"
            onMouseEnter={() => setActive(i)}
          />
        ))}
      </svg>
    </figure>
  );
}
