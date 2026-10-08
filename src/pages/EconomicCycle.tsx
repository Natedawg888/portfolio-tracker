import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatAuckland } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { PhaseNews } from '../components/PhaseNews';
import type { EconomicCycleResponse, EconomicIndicatorCard } from '../types/economy';
import { isCurrentCycleRequest, nextCycleLoad, shouldApplyCyclePayload } from './cycleLoad';

function formatSourceDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-NZ', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)));
  }
  return formatAuckland(iso);
}

function CountryControl({
  country,
  options,
  disabled,
  onChange,
}: {
  country: string;
  options: Array<{ code: string; name: string }>;
  disabled: boolean;
  onChange: (code: string) => void;
}) {
  return (
    <label className="country-control">
      <span>Country</span>
      <select
        value={country}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function rangeSentence(level: string): string {
  if (level === 'low') return 'This reading is in the low range.';
  if (level === 'high') return 'This reading is in the high range.';
  if (level === 'moderate') return 'This reading is in the middle range.';
  return `This reading is ${level}.`;
}

function changeSentence(change: string): string | null {
  if (change === 'rising') return 'It is higher than the previous reading.';
  if (change === 'falling') return 'It is lower than the previous reading.';
  if (change === 'stable') return 'It is close to the previous reading.';
  if (change === 'unknown') return null;
  return `Compared with the previous reading, it is ${change}.`;
}

function indicatorReading(card: EconomicIndicatorCard): string | null {
  const sentences: string[] = [];
  if (card.level) sentences.push(rangeSentence(card.level));
  if (card.change) {
    const sentence = changeSentence(card.change);
    if (sentence) sentences.push(sentence);
  }
  // Not scored means there is no phase. The server still sends score 0 and contribution 0.
  if (card.status !== 'Not scored') {
    if (card.score != null) sentences.push(`The match with this phase is ${card.score} out of 100.`);
    if (card.contribution != null) {
      sentences.push(`It adds ${card.contribution} weighted points toward this phase.`);
    }
  }
  return sentences.length > 0 ? sentences.join(' ') : null;
}

function indicatorStatus(status: string): string {
  if (status === 'Diverges from this phase') {
    return 'This reading does not line up with the current phase.';
  }
  if (status === 'Not available') return 'Not enough data yet';
  return status;
}

function nextQuarter(period: string): string | null {
  const match = period.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;
  let year = Number(match[1]);
  let quarter = Number(match[2]) + 1;
  if (quarter === 5) {
    quarter = 1;
    year += 1;
  }
  return `${year}-Q${quarter}`;
}

function economyKey(country: string): string {
  return `economy:${country}`;
}

export function EconomicCycle() {
  const [country, setCountry] = useState('NZ');
  const initialCycle = readPageCache<EconomicCycleResponse>(economyKey('NZ'));
  const [data, setData] = useState<EconomicCycleResponse | null>(initialCycle ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialCycle == null);
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((refresh = false) => {
    const ticket = nextCycleLoad(requestSeq.current, country);
    requestSeq.current = ticket.requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const stamp = beginPageRead(economyKey(ticket.country));
    const cached = readPageCache<EconomicCycleResponse>(economyKey(ticket.country));
    if (!refresh && cached?.country === ticket.country) {
      setData(cached);
      setLoading(false);
    }
    return api.economy
      .cycle({ refresh, country: ticket.country, signal: controller.signal })
      .then((payload) => {
        if (!isCurrentCycleRequest(ticket, requestSeq.current)) return;
        if (!shouldApplyCyclePayload(ticket, requestSeq.current, payload.country)) {
          setError('The extract was for a different country, so it was not shown.');
          return;
        }
        if (!commitPageRead(stamp, payload)) return;
        setData(payload);
        setError(null);
      })
      .catch((err: Error) => {
        if (!isCurrentCycleRequest(ticket, requestSeq.current) || controller.signal.aborted) return;
        setError(err.message);
      })
      .finally(() => {
        if (isCurrentCycleRequest(ticket, requestSeq.current)) setLoading(false);
      });
  }, [country]);

  useEffect(() => {
    void load(false);
    return () => {
      requestSeq.current += 1;
      abortRef.current?.abort();
    };
  }, [load]);

  if (error && !data) {
    return (
      <div className="panel warn econ-page">
        <h2 className="page-title">Economic cycle</h2>
        <p>{error}</p>
      </div>
    );
  }

  const options = data?.countries?.length
    ? data.countries
    : [
        { code: 'NZ', name: 'New Zealand' },
        { code: 'US', name: 'United States' },
      ];
  const selectedName = options.find((option) => option.code === country)?.name ?? country;
  const showing = data && data.country === country ? data : null;

  if (!showing) {
    return (
      <div className="panel econ-page">
        <CountryControl
          country={country}
          options={options}
          disabled={loading}
          onChange={(next) => {
            const cached = readPageCache<EconomicCycleResponse>(economyKey(next));
            if (cached?.country === next) {
              setData(cached);
              setLoading(false);
            } else {
              setLoading(true);
            }
            setCountry(next);
          }}
        />
        <h2 className="page-title">Economic cycle</h2>
        {error ? (
          <p>{error}</p>
        ) : loading ? (
          <p className="muted">Loading {selectedName} indicator extracts. The first load can take a minute.</p>
        ) : (
          <p className="muted">No {selectedName} extract is on screen.</p>
        )}
      </div>
    );
  }

  const phase = showing.phase;

  return (
    <div className="stack econ-page">
      {showing.provider.kind === 'sample' ? (
        <div className="panel warn">
          <h2>Sample data — not live</h2>
          <p>
            These figures are a labelled fixture, not official statistics, and they are not current. Set the provider back to the public extracts to leave this mode.
          </p>
        </div>
      ) : null}
      {showing.refreshError ? (
        <div className="panel warn">
          <p>{showing.refreshError}</p>
        </div>
      ) : null}

      <section className="hero-card hero-card--centered">
        <CountryControl
          country={country}
          options={options}
          disabled={loading}
          onChange={(next) => {
            const cached = readPageCache<EconomicCycleResponse>(economyKey(next));
            if (cached?.country === next) {
              setData(cached);
              setLoading(false);
            } else {
              setLoading(true);
            }
            setCountry(next);
          }}
        />
        <h2 className="page-title">Economic cycle</h2>
        <p className="eyebrow">Current economic phase</p>
        <p className="hero-value">{phase ? phase.label : 'Not available'}</p>
        <p className="stat-value">
          {phase ? `${phase.confidence}% confidence` : 'No confidence'}
        </p>
        <p className="muted small">
          Confidence is how strongly the available indicators support this phase. It is not a forecast and it is not certainty.
        </p>
        {phase ? (
          <p className="muted small">
            Overall score {phase.score} · {phase.momentumLabel}
            {phase.previousPhaseLabel ? ` · Previous phase ${phase.previousPhaseLabel}` : ''}
          </p>
        ) : null}
        <p className="muted small">
          {showing.countryName}
          {showing.asOfLabel ? ` · As of ${showing.asOfLabel}` : ''}
          {' · Last updated '}
          {showing.lastUpdated ? formatAuckland(showing.lastUpdated) : '—'}
        </p>
        <p className="muted small">{showing.provider.label}</p>
        {phase ? <p className="page-lead">{phase.explanation}</p> : (
          <p className="page-lead">No phase was calculated. Missing series are left blank rather than filled in.</p>
        )}
        <button
          type="button"
          className="btn small"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void load(true);
          }}
        >
          {loading ? 'Refreshing extracts…' : 'Refresh extracts'}
        </button>
      </section>

      <section className="panel" aria-label="Economic cycle">
        <ol className="cycle-rail">
          {showing.cycle.map((step, index) => (
            <li key={step.id} className="cycle-step">
              <span className={`cycle-node phase-${step.id}${step.active ? ' active' : ''}`} aria-current={step.active ? 'true' : undefined}>
                {step.label}
              </span>
              {index < showing.cycle.length - 1 ? <span className="cycle-arrow" aria-hidden="true">→</span> : null}
            </li>
          ))}
        </ol>
        <p className="muted small">
          Recession can be followed by Recovery when the indicators change. The highlighted phase is calculated from the data below, not from a timer.
        </p>
      </section>

      <section className="grid cards dashboard-cards" aria-label="Economic indicators">
        {showing.indicators.map((card) => (
          <IndicatorCardView key={card.type} card={card} />
        ))}
      </section>

      <PhaseNews key={`${country}:${phase?.id ?? 'none'}`} phase={phase?.id ?? null} country={country} />

      <section className="panel">
        <div className="panel-heading">
          <h2>How the phase changed</h2>
        </div>
        <p className="section-desc">{showing.vintageNote}</p>
        <PhaseChart points={showing.timeline} />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Historical asset-class context</h2>
        </div>
        <p className="section-desc">{showing.assetNote}</p>
        {showing.assetClasses.length > 0 ? (
          <div className="grid cards dashboard-cards">
            {showing.assetClasses.map((row) => (
              <article key={row.id} className="card">
                <h3>{row.label}</h3>
                <p>
                  <span className={`tendency tendency-${row.tendency}`}>Historical tendency {row.tendency}</span>
                </p>
                <p className="muted small">{row.explanation}</p>
              </article>
            ))}
          </div>
        ) : null}
        {showing.coverageNote ? <p className="muted small">{showing.coverageNote}</p> : null}
        <p className="muted small">{showing.disclaimer}</p>
      </section>
    </div>
  );
}

function IndicatorCardView({ card }: { card: EconomicIndicatorCard }) {
  if (!card.available || card.valueLabel == null) {
    return (
      <article className="card econ-indicator">
        <h3>{card.label}</h3>
        <p className="card-value">Not enough data yet</p>
        {card.description ? <p className="muted small">{card.description}</p> : null}
      </article>
    );
  }

  const reading = indicatorReading(card);
  return (
    <article className={`card econ-indicator${card.stale ? ' is-stale' : ''}`}>
      <h3>{card.label}</h3>
      <p className="card-value">{card.valueLabel}</p>
      <p className="muted small">
        Previous {card.previousLabel ?? '—'} · {card.directionLabel}
      </p>
      <p className="muted small">{indicatorStatus(card.status)}</p>
      {reading ? <p className="muted small">{reading}</p> : null}
      <p className="muted small">
        {card.periodLabel ? `Period ${card.periodLabel}` : 'No period'}
        {card.stale ? ' · Not current' : ''}
      </p>
      <p className="muted small">
        {card.publishedAtPrecision === 'release'
          ? `Published ${formatSourceDate(card.publishedAt)}`
          : card.publishedLabel ?? 'No publication date'}
      </p>
      <p className="muted small">Retrieved {formatAuckland(card.retrievedAt)}</p>
      {card.source ? (
        <p className="muted small">
          {card.sourceUrl ? (
            <a href={card.sourceUrl} target="_blank" rel="noreferrer">
              {card.source}
            </a>
          ) : (
            card.source
          )}
        </p>
      ) : null}
      {card.notes ? <p className="muted small">{card.notes}</p> : null}
      <p className="muted small">{card.description}</p>
      <Sparkline points={card.history} />
    </article>
  );
}

function Sparkline({ points }: { points: Array<{ period: string; value: number }> }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 140;
  const height = 36;
  const coords = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * (width - 4) + 2;
      const y = height - 2 - ((point.value - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="econ-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recent observations">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={coords} />
    </svg>
  );
}

function PhaseChart({ points }: { points: EconomicCycleResponse['timeline'] }) {
  if (points.length < 2) {
    return <p className="muted">Not enough quarters to draw a phase history.</p>;
  }
  const order = ['recovery', 'expansion', 'late_expansion', 'slowdown', 'recession'];
  const labels = ['Recovery', 'Expansion', 'Late Expansion', 'Slowdown', 'Recession'];
  const width = Math.max(720, points.length * 16 + 150);
  const height = 220;
  const left = 118;
  const top = 16;
  const plotW = width - left - 12;
  const plotH = height - top - 28;
  const yFor = (phase: string) => top + (order.indexOf(phase) + 0.5) * (plotH / order.length);
  const xFor = (index: number) => left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);

  const segments: string[] = [];
  let segment = '';
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const cmd = `${xFor(i).toFixed(1)},${yFor(point.phase).toFixed(1)}`;
    if (!segment) segment = `M ${cmd}`;
    else segment += ` L ${cmd}`;
    const follows = i + 1 < points.length && points[i + 1]?.period === nextQuarter(point.period);
    if (!follows) {
      segments.push(segment);
      segment = '';
    }
  }

  return (
    <>
      <div className="phase-chart-wrap">
        <svg className="phase-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Phase by quarter">
          {labels.map((label, index) => (
            <text key={label} x={8} y={yFor(order[index]!) + 4} className="phase-chart-label">
              {label}
            </text>
          ))}
          {segments.map((d) => (
            <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
          ))}
          {points.map((point, index) => (
            <circle
              key={point.period}
              cx={xFor(index)}
              cy={yFor(point.phase)}
              r={point.period === points[points.length - 1]?.period ? 4.5 : 3}
              className={`phase-dot phase-${point.phase}`}
            >
              <title>{`${point.label}: ${point.phaseLabel}, confidence ${point.confidence}%`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <details className="econ-phase-table">
        <summary>Phase by quarter</summary>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quarter</th>
                <th>Phase</th>
                <th>Score</th>
                <th>Confidence</th>
                <th>Momentum</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((point) => (
                <tr key={point.period}>
                  <td>{point.label}</td>
                  <td>{point.phaseLabel}</td>
                  <td>{point.score}</td>
                  <td>{point.confidence}%</td>
                  <td>{point.momentum}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
