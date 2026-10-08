import { useMemo } from 'react';
import { formatNzd } from '../api/client';

export type AssetBreakdownRow = {
  key: string;
  name: string;
  value: number;
  colour: string;
};

type Props = {
  rows: AssetBreakdownRow[];
  asOf?: string;
  title?: string;
  subtitle?: string;
  totalLabel?: string;
  centerLabel?: string;
  pieTitle?: string;
  barTitle?: string;
  note?: string;
  headingId?: string;
  legendLabel?: string;
  chartLabel?: string;
  /** When false, only the bar chart is shown (Portfolio). Default true (Dashboard). */
  showPie?: boolean;
  /** When false, hide the header total (e.g. Portfolio hero already shows it). Default true. */
  showTotal?: boolean;
  /**
   * When set, the bar chart is replaced with this quiet line if there are no
   * rows or every bucket is zero. Asset charts omit it so zero buckets stay.
   */
  barEmptyLabel?: string;
};

/** Asset-allocation pie and vertical bar charts. Zero rows stay visible in the legend. */
export function AssetBreakdownChart({
  rows,
  asOf,
  title = 'Assets by class',
  subtitle = 'Current NZD summary · positive asset buckets only',
  totalLabel = 'Known assets',
  centerLabel = 'Assets',
  pieTitle = 'Allocation',
  barTitle = 'By bucket',
  note = 'Debt and cash liabilities are shown separately above and are not treated as holdings.',
  headingId = 'asset-breakdown-title',
  legendLabel = 'Asset class totals',
  chartLabel = 'assets by class',
  showPie = true,
  showTotal = true,
  barEmptyLabel,
}: Props) {
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (Number.isFinite(row.value) ? Math.max(0, row.value) : 0), 0),
    [rows],
  );
  const barEmpty =
    Boolean(barEmptyLabel) && !rows.some((row) => Number.isFinite(row.value) && row.value > 0);
  // An all-zero debt chart draws a blank donut and a $0 header. Leave the quiet line on its own.
  const pieVisible = showPie && !barEmpty;
  const totalVisible = showTotal && !barEmpty;

  return (
    <section
      className={`panel asset-breakdown${pieVisible ? '' : ' asset-breakdown--bar-only'}`}
      aria-labelledby={headingId}
    >
      <div className="asset-breakdown-head">
        <div className="asset-breakdown-head-start">
          <h2 id={headingId}>{title}</h2>
          <p className="muted small">
            {subtitle}
            {asOf ? ` · as of ${asOf}` : ''}
          </p>
        </div>
        {totalVisible ? (
          <p className="asset-breakdown-total">
            <span className="muted small">{totalLabel}</span>
            <strong>{formatNzd(total)}</strong>
          </p>
        ) : (
          <div className="asset-breakdown-total" aria-hidden="true" />
        )}
        <div className="asset-breakdown-head-end" aria-hidden="true" />
      </div>

      <div className="asset-breakdown-grid">
        {pieVisible ? (
          <div className="asset-chart">
            <h3>{pieTitle}</h3>
            <PieChart rows={rows} total={total} centerLabel={centerLabel} chartLabel={chartLabel} />
          </div>
        ) : null}
        <div className="asset-chart">
          <h3>{barTitle}</h3>
          {barEmpty ? (
            <p className="muted small asset-bar-empty">{barEmptyLabel}</p>
          ) : (
            <BarChart rows={rows} chartLabel={chartLabel} />
          )}
        </div>
      </div>

      {barEmpty ? null : (
        <ul className="asset-breakdown-legend" aria-label={legendLabel}>
          {rows.map((row) => (
            <li key={row.key}>
              <span className="spend-swatch" style={{ background: row.colour }} aria-hidden />
              <span className="asset-legend-name">{row.name}</span>
              <strong>{formatNzd(row.value)}</strong>
              <span className="muted small">
                {total > 0 ? `${((Math.max(0, row.value) / total) * 100).toFixed(0)}%` : '0%'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="muted small asset-breakdown-note">{note}</p>}
    </section>
  );
}

function BarChart({ rows, chartLabel }: { rows: AssetBreakdownRow[]; chartLabel: string }) {
  const values = rows.map((row) => Math.max(0, Number.isFinite(row.value) ? row.value : 0));
  const max = Math.max(...values, 1);
  const n = Math.max(rows.length, 1);
  const chartW = 560;
  const topPad = 28;
  const longestLabel = rows.reduce((longest, row) => Math.max(longest, row.name.length), 0);
  // Vertical labels need room for the full name. Cap very long creditor names.
  const bottomPad = Math.max(56, Math.min(220, Math.min(longestLabel, 28) * 7 + 18));
  const leftPad = 16;
  const rightPad = 16;
  const plotH = 200;
  const chartH = topPad + plotH + bottomPad;
  const plotW = chartW - leftPad - rightPad;
  const slot = plotW / n;
  const barW = Math.min(48, Math.max(14, slot * 0.55));
  const baseline = topPad + plotH;

  return (
    <svg
      className="asset-bar-svg asset-bar-svg--vertical"
      viewBox={`0 0 ${chartW} ${chartH}`}
      role="img"
      aria-label={`Bar chart of ${chartLabel}`}
    >
      <line
        x1={leftPad}
        y1={baseline}
        x2={chartW - rightPad}
        y2={baseline}
        className="asset-bar-baseline"
      />
      {rows.map((row, index) => {
        const value = Math.max(0, Number.isFinite(row.value) ? row.value : 0);
        const height = value > 0 ? Math.max(3, (value / max) * plotH) : 0;
        const cx = leftPad + slot * index + slot / 2;
        const x = cx - barW / 2;
        const y = baseline - height;
        const label = row.name.length > 28 ? `${row.name.slice(0, 27)}…` : row.name;
        const labelY = baseline + 6;
        const showValue = slot >= 36;
        return (
          <g key={row.key}>
            <title>{`${row.name}: ${formatNzd(row.value)}`}</title>
            <rect
              x={x}
              y={y}
              width={barW}
              height={height}
              rx={6}
              fill={row.colour}
              opacity={0.9}
            />
            {showValue ? (
              <text
                x={cx}
                y={Math.min(y - 8, baseline - 8)}
                textAnchor="middle"
                className="spend-svg-value"
              >
                {formatNzd(row.value)}
              </text>
            ) : null}
            <text
              x={cx}
              y={labelY}
              textAnchor="end"
              transform={`rotate(-90 ${cx} ${labelY})`}
              className="spend-svg-label asset-bar-label"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PieChart({
  rows,
  total,
  centerLabel,
  chartLabel,
}: {
  rows: AssetBreakdownRow[];
  total: number;
  centerLabel: string;
  chartLabel: string;
}) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  // Keep the donut close to the viewBox edge so the responsive chart uses its box.
  const radius = 104;
  const innerRadius = 48;
  const positiveRows = rows.filter((row) => Number.isFinite(row.value) && row.value > 0);
  // Running start angles so each span equals value/total (no per-index re-reduce drift).
  const slices = positiveRows.reduce<
    { key: string; name: string; value: number; colour: string; start: number; end: number; fraction: number }[]
  >((acc, row) => {
    const fraction = total > 0 ? row.value / total : 0;
    const start = acc.length === 0 ? -Math.PI / 2 : acc[acc.length - 1].end;
    const end = start + fraction * Math.PI * 2;
    acc.push({ ...row, start, end, fraction });
    return acc;
  }, []);

  return (
    <div className="asset-pie-wrap">
      <svg
        className="asset-pie-svg"
        viewBox={`0 0 ${size} ${size}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Pie chart of ${chartLabel}`}
      >
        {slices.length === 0 ? (
          <circle cx={cx} cy={cy} r={radius} fill="var(--surface-2)" stroke="var(--border)" />
        ) : slices.length === 1 ? (
          <circle cx={cx} cy={cy} r={radius} fill={slices[0].colour}>
            <title>{`${slices[0].name}: ${formatNzd(slices[0].value)}`}</title>
          </circle>
        ) : (
          slices.map((slice) => (
            <path
              key={slice.key}
              d={arcPath(cx, cy, radius, slice.start, slice.end)}
              fill={slice.colour}
              opacity={0.92}
            >
              <title>{`${slice.name}: ${formatNzd(slice.value)} (${(slice.fraction * 100).toFixed(0)}%)`}</title>
            </path>
          ))
        )}
        <circle cx={cx} cy={cy} r={innerRadius} fill="var(--surface)" />
        <text x={cx} y={cy - 6} textAnchor="middle" className="spend-svg-value">
          {centerLabel}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="spend-svg-label">
          {formatNzd(total)}
        </text>
      </svg>
    </div>
  );
}

/**
 * Pie wedge path. Angles are radians with 0 = east; with SVG y-down, increasing
 * angle is clockwise, matching sweep-flag=1.
 * Arcs larger than π are split into ≤π segments so a dominant slice (e.g. 87%)
 * cannot collapse to the complementary minor arc via a wrong large-arc flag.
 */
function arcPath(cx: number, cy: number, radius: number, start: number, end: number): string {
  const delta = end - start;
  if (!Number.isFinite(delta) || delta <= 0) return '';

  const pt = (angle: number) => {
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    return `${round(x)} ${round(y)}`;
  };

  // Full circle cannot be expressed as a single SVG arc (start == end).
  if (delta >= Math.PI * 2 - 1e-6) {
    const mid = start + Math.PI;
    const a0 = pt(start);
    const a1 = pt(mid);
    return `M ${round(cx)} ${round(cy)} L ${a0} A ${radius} ${radius} 0 1 1 ${a1} A ${radius} ${radius} 0 1 1 ${a0} Z`;
  }

  const parts: string[] = [`M ${round(cx)} ${round(cy)} L ${pt(start)}`];
  let from = start;
  // Keep each A command ≤ 180° (large-arc=0) so sweep direction alone defines the wedge.
  while (end - from > Math.PI + 1e-9) {
    const mid = from + Math.PI;
    parts.push(`A ${radius} ${radius} 0 0 1 ${pt(mid)}`);
    from = mid;
  }
  parts.push(`A ${radius} ${radius} 0 0 1 ${pt(end)} Z`);
  return parts.join(' ');
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

