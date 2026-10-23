/**
 * Income vs expenses by month (KAN-126): paired columns from one baseline, one axis (NZD), a
 * legend, and a hover/focus readout per month with every series. A table view holds the same
 * numbers, so nothing depends on the chart or the tooltip. Colours are --chart-income and
 * --chart-expenses (validated for both themes); text stays in text colours.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatNzd } from '../../api/client';
import { compactNzd as compact, monthLong, monthShort, niceTicks } from '../../lib/profitLossView';

type Month = { month: string; incomeNzd: number; expensesNzd: number };

/** A column with a 4px rounded data end and a square foot on the baseline. */
function column(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const W = 720;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 52 };
const BAR_MAX = 24;
const GAP = 2;

export function MonthlyMoneyChart({ months, title }: { months: Month[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const ticks = useMemo(() => niceTicks(Math.max(0, ...months.flatMap((m) => [m.incomeNzd, m.expensesNzd]))), [months]);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, months.length);
  const barW = Math.min(BAR_MAX, (band * 0.7 - GAP) / 2);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const empty = months.every((m) => m.incomeNzd === 0 && m.expensesNzd === 0);

  function onKey(e: KeyboardEvent<SVGGElement>, i: number) {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? months.length - 1 : -1;
    if (next < 0 || next >= months.length) return;
    e.preventDefault();
    wrapRef.current?.querySelectorAll<SVGGElement>('.money-chart-hit')[next]?.focus();
  }

  const tip = active != null ? months[active] : null;
  const tipLeft = active != null ? ((PAD.left + band * active + band / 2) / W) * 100 : 0;

  return (
    <figure className="money-chart" aria-labelledby={`${tipId}-cap`}>
      <figcaption id={`${tipId}-cap`} className="money-chart-head">
        <span className="money-chart-title">{title}</span>
        <span className="money-chart-legend" aria-hidden={table}>
          <span className="money-chart-key">
            <span className="money-chart-swatch money-chart-swatch--income" /> Income
          </span>
          <span className="money-chart-key">
            <span className="money-chart-swatch money-chart-swatch--expenses" /> Expenses
          </span>
        </span>
        <button type="button" className="link-btn small money-chart-toggle" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? 'Show as chart' : 'Show as table'}
        </button>
      </figcaption>

      {table ? (
        <div className="money-chart-table-wrap">
          <table className="money-chart-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="num">Income</th>
                <th scope="col" className="num">Expenses</th>
                <th scope="col" className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthLong(m.month)}</th>
                  <td className="num">{formatNzd(m.incomeNzd)}</td>
                  <td className="num">{formatNzd(m.expensesNzd)}</td>
                  <td className="num">{formatNzd(m.incomeNzd - m.expensesNzd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : empty ? (
        <p className="muted small">Nothing tagged to this business in the period yet.</p>
      ) : (
        <div ref={wrapRef} className="money-chart-plot" onPointerLeave={() => setActive(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${title}: use the arrow keys to read each month`}>
            {ticks.map((t) => (
              <g key={t} aria-hidden="true">
                <line className="money-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="money-chart-axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                  {compact(t)}
                </text>
              </g>
            ))}
            {months.map((m, i) => {
              const cx = PAD.left + band * i + band / 2;
              const x1 = cx - barW - GAP / 2;
              const x2 = cx + GAP / 2;
              return (
                <g
                  key={m.month}
                  className="money-chart-hit"
                  tabIndex={0}
                  role="img"
                  aria-label={`${monthLong(m.month)}: income ${formatNzd(m.incomeNzd)}, expenses ${formatNzd(m.expensesNzd)}`}
                  aria-describedby={active === i ? tipId : undefined}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onKeyDown={(e) => onKey(e, i)}
                >
                  {/* The hit target is the whole month band, not just the bars. */}
                  <rect className="money-chart-band" x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} />
                  <path className="money-chart-bar money-chart-bar--income" d={column(x1, y(m.incomeNzd), barW, y(0) - y(m.incomeNzd))} />
                  <path className="money-chart-bar money-chart-bar--expenses" d={column(x2, y(m.expensesNzd), barW, y(0) - y(m.expensesNzd))} />
                  <text className="money-chart-axis" x={cx} y={H - 8} textAnchor="middle" aria-hidden="true">
                    {monthShort(m.month)}
                  </text>
                </g>
              );
            })}
            <line className="money-chart-baseline" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} aria-hidden="true" />
          </svg>
          {tip ? (
            <div id={tipId} role="tooltip" className={`money-chart-tip${tipLeft > 70 ? ' money-chart-tip--left' : ''}`} style={{ left: `${tipLeft}%` }}>
              <span className="money-chart-tip-month">{monthLong(tip.month)}</span>
              <span>
                <strong>{formatNzd(tip.incomeNzd)}</strong> income
              </span>
              <span>
                <strong>{formatNzd(tip.expensesNzd)}</strong> expenses
              </span>
              <span>
                <strong>{formatNzd(tip.incomeNzd - tip.expensesNzd)}</strong> net
              </span>
            </div>
          ) : null}
        </div>
      )}
    </figure>
  );
}
