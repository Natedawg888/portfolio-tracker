/**
 * Compact price-history sparkline for metal / crypto / stock holding cards.
 * Ranges: 1D | 5D | 1M | 1Y. Never invents — shows honest empty/unavailable.
 */
import { useEffect, useId, useState } from 'react';
import { api, formatNzd } from '../api/client';

export type ChartRange = '1d' | '5d' | '1m' | '1y';

const RANGES: { key: ChartRange; label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '5d', label: '5D' },
  { key: '1m', label: '1M' },
  { key: '1y', label: '1Y' },
];

type Point = { at: string; price: number };

type HistoryPayload = {
  status: 'ok' | 'unavailable';
  source: string;
  currency: string;
  unit: string;
  range: ChartRange;
  points: Point[];
  message: string | null;
};

type Props =
  | { assetClass: 'crypto'; ticker: string }
  | { assetClass: 'metal'; metal: string }
  | { assetClass: 'stock'; ticker: string; exchange?: string | null };

function parseAt(at: string): number {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
}

function compactPrice(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

export function HoldingPriceChart(props: Props) {
  const [range, setRange] = useState<ChartRange>('1m');
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gradId = useId().replace(/:/g, '');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params =
      props.assetClass === 'crypto'
        ? { assetClass: 'crypto' as const, ticker: props.ticker, range }
        : props.assetClass === 'metal'
          ? { assetClass: 'metal' as const, metal: props.metal, range }
          : {
              assetClass: 'stock' as const,
              ticker: props.ticker,
              exchange: props.exchange,
              range,
            };
    api.quotes
      .history(params)
      .then((r) => {
        if (!cancelled) {
          setData(r as HistoryPayload);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setData(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    range,
    props.assetClass,
    props.assetClass === 'metal' ? props.metal : '',
    props.assetClass === 'crypto' || props.assetClass === 'stock' ? props.ticker : '',
    props.assetClass === 'stock' ? props.exchange ?? '' : '',
  ]);

  const points = data?.status === 'ok' ? data.points : [];
  const first = points[0]?.price;
  const last = points[points.length - 1]?.price;
  const delta =
    first != null && last != null && first > 0 ? ((last - first) / first) * 100 : null;
  const up = delta == null ? null : delta >= 0;

  const width = 280;
  const height = 72;
  const padX = 4;
  const padY = 6;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  let pathD = '';
  let areaD = '';
  if (points.length >= 1) {
    const times = points.map((p) => parseAt(p.at));
    const vals = points.map((p) => p.price);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);
    const tSpan = Math.max(tMax - tMin, 1);
    const vSpan = Math.max(vMax - vMin, vMax * 0.002, 1e-9);
    const xOf = (at: string) => padX + ((parseAt(at) - tMin) / tSpan) * plotW;
    const yOf = (v: number) => padY + (1 - (v - vMin) / vSpan) * plotH;
    pathD = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.at).toFixed(1)},${yOf(p.price).toFixed(1)}`)
      .join(' ');
    const lastPt = points[points.length - 1]!;
    const firstPt = points[0]!;
    areaD = `${pathD} L${xOf(lastPt.at).toFixed(1)},${(padY + plotH).toFixed(1)} L${xOf(firstPt.at).toFixed(1)},${(padY + plotH).toFixed(1)} Z`;
  }

  const stroke = up == null ? '#6a8fa8' : up ? '#3d9a6a' : '#e07070';
  return (
    <div className="holding-price-chart">
      <div className="holding-price-chart-toolbar">
        <span className="muted small holding-price-chart-label">Price history</span>
        <div className="holding-price-range" role="group" aria-label="History range">
          {RANGES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={range === key ? 'btn primary holding-range-btn' : 'btn ghost holding-range-btn'}
              onClick={() => setRange(key)}
              aria-pressed={range === key}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="muted small holding-price-chart-status">Loading…</p>}

      {!loading && error && (
        <p className="muted small holding-price-chart-status" title={error}>
          History unavailable
        </p>
      )}

      {!loading && !error && data?.status !== 'ok' && (
        <p
          className="muted small holding-price-chart-status"
          title={data?.message ?? 'unavailable'}
        >
          {data?.message?.slice(0, 80) ?? 'History unavailable'}
          {(data?.message?.length ?? 0) > 80 ? '…' : ''}
        </p>
      )}

      {!loading && !error && data?.status === 'ok' && points.length === 0 && (
        <p className="muted small holding-price-chart-status">No history points</p>
      )}

      {!loading && !error && data?.status === 'ok' && points.length > 0 && (
        <>
          <svg
            className="holding-price-chart-svg"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${range.toUpperCase()} price history`}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            {areaD && <path d={areaD} fill={`url(#${gradId})`} />}
            {points.length === 1 ? (
              <circle
                cx={width / 2}
                cy={height / 2}
                r={3.5}
                fill={stroke}
              >
                <title>{formatNzd(points[0]!.price)}</title>
              </circle>
            ) : (
              <path
                d={pathD}
                fill="none"
                stroke={stroke}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
          </svg>
          <div className="holding-price-chart-footer">
            <span className="muted small" title={data.message ?? data.source}>
              {compactPrice(last!)} NZD
              {data.unit === 'oz_t' ? '/oz t' : data.unit === 'share' ? '/sh' : ''}
              {' · '}
              {data.source.split('+')[0]}
            </span>
            {delta != null && (
              <span className={up ? 'return-pos small' : 'return-neg small'}>
                {up ? '+' : ''}
                {delta.toFixed(2)}%
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
