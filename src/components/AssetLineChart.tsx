/**
 * Multi-series SVG line chart for yearly net-worth / asset growth.
 * Only plots points that exist — never invents interpolated balances.
 * Resolution: by day | by month (bucket last real snapshot; skip empty buckets).
 */
import { formatNzd } from '../api/client';
import { isMoneyHidden, MONEY_MASK } from '../lib/privacy';

export type LinePoint = {
  /** ISO timestamp or YYYY-MM-DD */
  at: string;
  value: number;
};

export type LineSeries = {
  key: string;
  label: string;
  colour: string;
  points: LinePoint[];
};

/** Chart time resolution — only real snapshot buckets, never filled gaps. */
export type ChartResolution = 'day' | 'month';

const PALETTE = [
  '#3d9a6a',
  '#4a8fd4',
  '#c47a2c',
  '#9a6ad4',
  '#d45a7a',
  '#5ab8a0',
  '#d4b84a',
  '#6a8fd4',
  '#a07050',
  '#70a0c0',
  '#e09060',
  '#80c0e0',
];

export function seriesColour(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function aucklandParts(iso: string): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  return {
    y: parts.find((p) => p.type === 'year')?.value ?? '2026',
    m: parts.find((p) => p.type === 'month')?.value ?? '01',
    d: parts.find((p) => p.type === 'day')?.value ?? '01',
  };
}

/** Bucket key in Auckland calendar: YYYY-MM-DD (day) or YYYY-MM (month). */
export function bucketKey(at: string, resolution: ChartResolution): string {
  const { y, m, d } = aucklandParts(at);
  return resolution === 'month' ? `${y}-${m}` : `${y}-${m}-${d}`;
}

/**
 * Collapse points into day or month buckets.
 * Keeps the chronologically last real value in each bucket — never invents empty buckets.
 */
export function resampleSeries(
  series: LineSeries[],
  resolution: ChartResolution,
): LineSeries[] {
  return series.map((s) => {
    const sorted = [...s.points].sort((a, b) => parseAt(a.at) - parseAt(b.at));
    const buckets = new Map<string, LinePoint>();
    for (const p of sorted) {
      if (!Number.isFinite(p.value)) continue;
      const key = bucketKey(p.at, resolution);
      // Last write wins = last real snapshot in that day/month
      buckets.set(key, {
        at: resolution === 'month' ? `${key}-01` : key,
        value: p.value,
      });
    }
    const points = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, p]) => p);
    return { ...s, points };
  });
}

type Props = {
  series: LineSeries[];
  title?: string;
  emptyHint?: string;
  height?: number;
  /** day = one point per Auckland day with data; month = one per month with data */
  resolution?: ChartResolution;
  /** Show the technical resolution footnote under the title (default off). */
  showResolutionNote?: boolean;
  /** Stretch SVG to full panel width (no max-width cap). */
  fullWidth?: boolean;
};

function parseAt(at: string): number {
  const t = Date.parse(at.length === 7 ? `${at}-01T00:00:00` : at.length === 10 ? `${at}T00:00:00` : at);
  return Number.isFinite(t) ? t : 0;
}

function axisLabel(at: string, resolution: ChartResolution): string {
  try {
    if (resolution === 'month') {
      const d = new Date(parseAt(at));
      return new Intl.DateTimeFormat('en-NZ', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d);
    }
    return new Intl.DateTimeFormat('en-NZ', {
      timeZone: 'Pacific/Auckland',
      day: 'numeric',
      month: 'short',
    }).format(new Date(at.includes('T') || at.length > 10 ? at : `${at}T12:00:00+13:00`));
  } catch {
    return at.slice(0, 10);
  }
}

/**
 * Auto Y domain padded around data min/max.
 * Only anchors to 0 when values cross or sit near zero — not when balances are large.
 */
export function computeYDomain(values: number[]): { vMin: number; vMax: number } {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const rawSpan = dataMax - dataMin;
  const magnitude = Math.max(Math.abs(dataMin), Math.abs(dataMax), 1);
  const padBase = Math.max(rawSpan, magnitude * 0.02, 1);
  const pad = padBase * 0.12;

  let vMin = dataMin - pad;
  let vMax = dataMax + pad;

  const crossesZero = dataMin <= 0 && dataMax >= 0;
  const nearZeroFromAbove = dataMin > 0 && dataMin <= padBase * 0.5;
  const nearZeroFromBelow = dataMax < 0 && dataMax >= -padBase * 0.5;

  if (crossesZero) {
    // already spans 0; keep padded ends
  } else if (nearZeroFromAbove) {
    vMin = 0;
  } else if (nearZeroFromBelow) {
    vMax = 0;
  }

  if (vMax <= vMin) {
    vMax = vMin + Math.max(magnitude * 0.02, 1);
  }
  return { vMin, vMax };
}

export function AssetLineChart({
  series,
  title = 'Growth',
  emptyHint = 'No snapshot points yet for this series.',
  height,
  resolution = 'day',
  showResolutionNote = false,
  fullWidth = false,
}: Props) {
  const resampled = resampleSeries(series, resolution);
  const active = resampled.filter((s) => s.points.length > 0);
  const allPoints = active.flatMap((s) => s.points);

  if (allPoints.length === 0) {
    return (
      <div className={'line-chart' + (fullWidth ? ' line-chart-full' : '')}>
        {title && <h4 className="line-chart-title">{title}</h4>}
        <p className="muted small line-chart-empty">{emptyHint}</p>
      </div>
    );
  }

  const uniqueTimes = [...new Set(allPoints.map((p) => p.at))].sort(
    (a, b) => parseAt(a) - parseAt(b),
  );
  const fewPoints = uniqueTimes.length <= 3;
  const chartH = height ?? (fewPoints ? 180 : 260);

  const times = allPoints.map((p) => parseAt(p.at));
  const values = allPoints.map((p) => p.value);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const { vMin, vMax } = computeYDomain(values);
  const tSpan = Math.max(tMax - tMin, 1);
  const vSpan = Math.max(vMax - vMin, 1);

  const padL = 52;
  const padR = 12;
  const padT = fewPoints ? 12 : 16;
  const padB = fewPoints ? 24 : 28;
  const width = 640;
  const plotW = width - padL - padR;
  const plotH = chartH - padT - padB;

  function xOf(at: string): number {
    return padL + ((parseAt(at) - tMin) / tSpan) * plotW;
  }
  function yOf(v: number): number {
    return padT + (1 - (v - vMin) / vSpan) * plotH;
  }

  const tickStep = Math.max(1, Math.ceil(uniqueTimes.length / 6));
  const xTicks = uniqueTimes.filter((_, i) => i % tickStep === 0 || i === uniqueTimes.length - 1);

  const yTicks = [vMin, vMin + vSpan / 2, vMax];

  return (
    <div className={'line-chart' + (fewPoints ? ' line-chart-compact' : '') + (fullWidth ? ' line-chart-full' : '')}>
      {title && <h4 className="line-chart-title">{title}</h4>}
      {showResolutionNote && (
        <p className="muted small line-chart-meta">
          {resolution === 'day' ? 'Daily' : 'Monthly'} snapshots only
        </p>
      )}
      <svg
        className="line-chart-svg"
        viewBox={`0 0 ${width} ${chartH}`}
        role="img"
        aria-label={title}
      >
        {yTicks.map((v, i) => (
          <g key={`y-${i}`}>
            <line
              x1={padL}
              x2={width - padR}
              y1={yOf(v)}
              y2={yOf(v)}
              className="line-chart-grid"
            />
            <text
              x={padL - 6}
              y={yOf(v)}
              textAnchor="end"
              dominantBaseline="middle"
              className="line-chart-axis"
            >
              {compactNzd(v)}
            </text>
          </g>
        ))}
        {xTicks.map((at) => (
          <text
            key={at}
            x={xOf(at)}
            y={chartH - 8}
            textAnchor="middle"
            className="line-chart-axis"
          >
            {axisLabel(at, resolution)}
          </text>
        ))}

        {active.map((s) => {
          const sorted = [...s.points].sort((a, b) => parseAt(a.at) - parseAt(b.at));
          if (sorted.length === 1) {
            const p = sorted[0];
            return (
              <g key={s.key}>
                <circle cx={xOf(p.at)} cy={yOf(p.value)} r={4} fill={s.colour}>
                  <title>{`${s.label}: ${formatNzd(p.value)} @ ${axisLabel(p.at, resolution)}`}</title>
                </circle>
              </g>
            );
          }
          const d = sorted
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.at)} ${yOf(p.value)}`)
            .join(' ');
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={s.colour} strokeWidth={2} strokeLinejoin="round" />
              {sorted.map((p) => (
                <circle
                  key={`${s.key}-${p.at}`}
                  cx={xOf(p.at)}
                  cy={yOf(p.value)}
                  r={3.5}
                  fill={s.colour}
                >
                  <title>{`${s.label}: ${formatNzd(p.value)} @ ${axisLabel(p.at, resolution)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <ul className="line-chart-legend" aria-label="Series">
        {active.map((s) => (
          <li key={s.key}>
            <span className="spend-swatch" style={{ background: s.colour }} aria-hidden />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function compactNzd(n: number): string {
  if (isMoneyHidden()) return MONEY_MASK;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}
