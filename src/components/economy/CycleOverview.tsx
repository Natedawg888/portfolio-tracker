import { useId, useState, type ReactNode } from 'react';
import { formatAuckland } from '../../api/client';
import { STATUS_META, groupBySignal, pct, scorePosition, shortPeriod } from '../../lib/economyView';
import type { EconomicCycleResponse, EconomicIndicatorCard, EconomicTakeaway } from '../../types/economy';

const TREND_ICON: Record<EconomicTakeaway['trend'], string> = {
  up: '↑',
  down: '↓',
  flat: '→',
  mixed: '⇅',
  unknown: '·',
};

const ANCHORS: Array<{ label: string; at: number }> = [
  { label: 'Recession', at: -80 },
  { label: 'Slowdown', at: -40 },
  { label: 'Recovery', at: 15 },
  { label: 'Expansion', at: 55 },
  { label: 'Late', at: 75 },
];

export function CycleOverview({
  data,
  controls,
  loading,
  onRefresh,
  onShowIndicator,
}: {
  data: EconomicCycleResponse;
  controls: ReactNode;
  loading: boolean;
  onRefresh: () => void;
  onShowIndicator: (type: string) => void;
}) {
  const phase = data.phase;
  const [whyOpen, setWhyOpen] = useState(false);
  const whyId = useId();

  return (
    <section className="hero-card econ-overview" aria-labelledby="econ-title">
      <div className="econ-overview-top">
        <div>
          <p className="eyebrow">{data.countryName} · economic cycle</p>
          <h2 id="econ-title" className="page-title">
            {phase ? phase.label : 'Phase not available'}
          </h2>
          <p className="muted small econ-asof">
            {data.asOfLabel ? `Latest complete quarter: ${data.asOfLabel}` : 'No quarter could be scored'}
            {' · '}Retrieved {data.lastUpdated ? formatAuckland(data.lastUpdated) : '—'}
          </p>
        </div>
        <div className="econ-overview-actions">
          {controls}
          <button type="button" className="btn small" disabled={loading} onClick={onRefresh}>
            {loading ? 'Refreshing…' : 'Refresh data'}
          </button>
        </div>
      </div>

      {phase ? (
        <div className="econ-gauges">
          <div className="econ-gauge">
            <div className="econ-gauge-head">
              <span>Model confidence</span>
              <strong>{phase.confidence}<span className="muted"> / 100</span></strong>
            </div>
            <div
              className="econ-meter"
              role="meter"
              aria-label="Model confidence"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={phase.confidence}
              aria-valuetext={`${phase.confidence} out of 100, indicator agreement score`}
            >
              <span style={{ width: `${pct(phase.confidence)}%` }} />
            </div>
            <p className="muted tiny">How strongly the available indicators agree. Not a probability or a forecast.</p>
          </div>
          <div className="econ-gauge">
            <div className="econ-gauge-head">
              <span>Overall score</span>
              <strong>{phase.score > 0 ? `+${phase.score}` : phase.score}</strong>
            </div>
            <div className="econ-scale" aria-hidden="true">
              {ANCHORS.map((anchor) => (
                <span key={anchor.label} className="econ-scale-tick" style={{ left: `${scorePosition(anchor.at)}%` }} />
              ))}
              <span className="econ-scale-marker" style={{ left: `${scorePosition(phase.score)}%` }} />
            </div>
            <div className="econ-scale-labels muted tiny" aria-hidden="true">
              <span>−100 contraction</span>
              <span>+100 strong growth</span>
            </div>
            <p className="sr-only">Overall score {phase.score} on a scale from −100, recession-like, to +100, strong expansion.</p>
          </div>
          <div className="econ-gauge econ-gauge--facts">
            <p>
              <span className="muted">Momentum</span> <strong>{phase.momentumLabel}</strong>
            </p>
            <p>
              <span className="muted">Previous quarter</span> <strong>{phase.previousPhaseLabel ?? '—'}</strong>
            </p>
            <p>
              <span className="muted">Indicators used</span>{' '}
              <strong>
                {phase.availableCount} of {phase.catalogueCount}
              </strong>
            </p>
          </div>
        </div>
      ) : (
        <p className="page-lead">No phase was calculated. Missing series are left blank rather than filled in.</p>
      )}

      {data.takeaways.length > 0 ? (
        <ul className="econ-takeaways" aria-label="Key takeaways">
          {data.takeaways.map((item) => (
            <li key={item.id} className={`econ-takeaway trend-${item.trend}`}>
              <span className="econ-takeaway-icon" aria-hidden="true">
                {TREND_ICON[item.trend]}
              </span>
              <div>
                <p className="econ-takeaway-head">{item.headline}</p>
                <p className="muted small">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <FreshnessStrip data={data} />

      {phase ? (
        <div className="econ-why">
          <button
            type="button"
            className="econ-why-toggle"
            aria-expanded={whyOpen}
            aria-controls={whyId}
            onClick={() => setWhyOpen((open) => !open)}
          >
            <span aria-hidden="true">{whyOpen ? '▾' : '▸'}</span> Why {phase.label}?
          </button>
          {whyOpen ? <WhyPanel id={whyId} data={data} onShowIndicator={onShowIndicator} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function FreshnessStrip({ data }: { data: EconomicCycleResponse }) {
  const f = data.freshness;
  const items: string[] = [];
  if (f.oldestPeriod && f.newestPeriod) {
    items.push(
      f.mixedPeriods
        ? `Readings span ${shortPeriod(f.oldestPeriod)} to ${shortPeriod(f.newestPeriod)}`
        : `All readings for ${shortPeriod(f.newestPeriod)}`,
    );
  }
  if (f.staleCount > 0) items.push(`${f.staleCount} older than usual`);
  if (f.missingCount > 0) items.push(`${f.missingCount} missing`);
  if (f.derivedCount > 0) items.push(`${f.derivedCount} calculated in this app`);
  if (items.length === 0) return null;
  return (
    <p className={`econ-freshness${f.staleCount > 0 || f.missingCount > 0 ? ' has-warning' : ''}`}>
      {f.staleCount > 0 || f.missingCount > 0 ? <span aria-hidden="true">⚠ </span> : null}
      {items.join(' · ')}. Indicators are published on different schedules, so they do not all describe the same month.
    </p>
  );
}

function WhyPanel({
  id,
  data,
  onShowIndicator,
}: {
  id: string;
  data: EconomicCycleResponse;
  onShowIndicator: (type: string) => void;
}) {
  const phase = data.phase!;
  const groups = groupBySignal(data.indicators);
  const d = phase.confidenceDetail;
  const sorted = [...data.phaseFits].sort((a, b) => b.fit - a.fit);
  return (
    <div id={id} className="econ-why-panel">
      <div className="econ-why-grid">
        <SignalList title="Supporting" tone="supports" cards={groups.supports} onShow={onShowIndicator} />
        <SignalList title="Mixed" tone="mixed" cards={groups.mixed} onShow={onShowIndicator} />
        <SignalList title="Conflicting" tone="conflicts" cards={groups.conflicts} onShow={onShowIndicator} />
        <SignalList title="No data" tone="insufficient" cards={groups.insufficient} onShow={onShowIndicator} />
      </div>

      <h3 className="econ-subhead">Fit to each phase</h3>
      <ul className="econ-fit-bars">
        {sorted.map((row) => (
          <li key={row.id} className={row.id === phase.id ? 'is-current' : undefined}>
            <span className="econ-fit-label">
              {row.label}
              {row.id === phase.id ? <span className="econ-badge">Calculated</span> : null}
            </span>
            <span className="econ-fit-track" aria-hidden="true">
              <span style={{ width: `${pct(row.fit)}%` }} />
            </span>
            <span className="econ-fit-value">{row.fit}</span>
          </li>
        ))}
      </ul>
      <p className="muted tiny">
        Fit is the weighted share of each phase’s rules that today’s readings meet (0–100). The highest fit is the calculated phase.
      </p>

      <h3 className="econ-subhead">How confidence is built</h3>
      <table className="data-table econ-confidence-table">
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Value</th>
            <th scope="col">Weight</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Support — fit of the calculated phase</th>
            <td>{Math.round(d.support * 100)}</td>
            <td>{d.weights.support}</td>
          </tr>
          <tr>
            <th scope="row">Margin — lead over the runner-up</th>
            <td>{Math.round(d.margin * 100)}</td>
            <td>{d.weights.margin}</td>
          </tr>
          <tr>
            <th scope="row">Coverage — indicators with data</th>
            <td>{Math.round(d.coverage * 100)}</td>
            <td>{d.weights.coverage}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted tiny">
        Confidence = weighted sum, rounded{d.cap != null ? `, then capped at ${d.cap} because few indicators had data` : ''}. Result:{' '}
        {phase.confidence}.
      </p>

      <h3 className="econ-subhead">Limitations</h3>
      <ul className="econ-limits muted small">
        <li>Rule-based thresholds, not a statistical model. The score is not calibrated against past recessions.</li>
        <li>Indicators come from different months and quarters; some are older than others.</li>
        <li>History uses revised data, so past phases look clearer than they were at the time.</li>
        <li>Educational context only. It is not a forecast and not financial advice.</li>
      </ul>
    </div>
  );
}

function SignalList({
  title,
  tone,
  cards,
  onShow,
}: {
  title: string;
  tone: 'supports' | 'mixed' | 'conflicts' | 'insufficient';
  cards: EconomicIndicatorCard[];
  onShow: (type: string) => void;
}) {
  const meta = STATUS_META[tone];
  return (
    <div className={`econ-signal-list tone-${tone}`}>
      <h3 className="econ-subhead">
        <span aria-hidden="true">{meta.icon}</span> {title} <span className="muted">({cards.length})</span>
      </h3>
      {cards.length === 0 ? (
        <p className="muted tiny">None</p>
      ) : (
        <ul>
          {cards.map((card) => (
            <li key={card.type}>
              <button type="button" className="econ-linklike" onClick={() => onShow(card.type)}>
                {card.label}
              </button>
              {card.available && card.weight != null ? (
                <span className="muted tiny">
                  {' '}
                  {card.contribution?.toFixed(2)} of {card.weight.toFixed(1)} pts
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
