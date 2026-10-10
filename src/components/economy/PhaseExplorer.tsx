import { useId, useState } from 'react';
import { phaseRelation, shortPeriod } from '../../lib/economyView';
import type { EconomicCycleResponse, EconomicPhase } from '../../types/economy';

/**
 * The five phases as toggle buttons. Selecting one only changes what this panel
 * describes. The calculated phase comes from the payload and is never replaced.
 */
export function PhaseExplorer({ data }: { data: EconomicCycleResponse }) {
  const current = data.phase?.id ?? null;
  const [selected, setSelected] = useState<EconomicPhase>(current ?? 'expansion');
  const panelId = useId();
  const guide = data.phaseGuide.find((row) => row.id === selected) ?? null;
  const exploring = selected !== current;

  return (
    <section className="panel econ-explorer" aria-labelledby="econ-explorer-title">
      <div className="panel-heading">
        <h2 id="econ-explorer-title">Explore the cycle</h2>
        {exploring && current ? (
          <button type="button" className="btn small ghost" onClick={() => setSelected(current)}>
            Back to current
          </button>
        ) : null}
      </div>
      <ol className="econ-rail" aria-label="Economic phases in the usual order">
        {data.cycle.map((step, index) => {
          const isCurrent = step.id === current;
          const isSelected = step.id === selected;
          return (
            <li key={step.id} className="econ-rail-step">
              <button
                type="button"
                className={`econ-rail-node phase-${step.id}${isCurrent ? ' is-current' : ''}${isSelected ? ' is-selected' : ''}`}
                aria-pressed={isSelected}
                aria-controls={panelId}
                aria-describedby={isCurrent ? `${panelId}-current` : undefined}
                onClick={() => setSelected(step.id)}
              >
                <span className="econ-rail-label">{step.label}</span>
                {isCurrent ? <span className="econ-badge econ-badge--solid">Now</span> : null}
              </button>
              {index < data.cycle.length - 1 ? (
                <span className="econ-rail-arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {current ? (
        <p id={`${panelId}-current`} className="sr-only">
          Currently calculated phase
        </p>
      ) : null}

      {guide ? (
        <div id={panelId} className={`econ-explorer-panel${exploring ? ' is-exploring' : ''}`} aria-live="polite">
          <div className="econ-explorer-head">
            <p className="eyebrow">{exploring ? 'Exploring — not the current phase' : 'Current calculated phase'}</p>
            <h3>{guide.label}</h3>
            <p className="muted small">{phaseRelation(current, selected)}</p>
          </div>

          <div className="econ-explorer-grid">
            <div>
              <h4 className="econ-subhead">What it means</h4>
              <p className="small">{guide.summary}</p>
              <p className="muted tiny">General definition, not calculated from the data.</p>

              <h4 className="econ-subhead">Today’s data vs this phase</h4>
              <p className="econ-bigfit">
                <strong>{guide.currentFit}</strong>
                <span className="muted"> / 100 fit</span>
              </p>
              <p className="muted tiny">
                {guide.quartersInPhase > 0
                  ? `The model placed ${guide.quartersInPhase} of ${guide.totalQuarters} quarters here since 2012, most recently ${shortPeriod(guide.lastSeen)}.`
                  : `The model did not place any of the ${guide.totalQuarters} replayed quarters in this phase.`}
              </p>
            </div>

            <div>
              <h4 className="econ-subhead">Signals the model looks for</h4>
              <ul className="econ-rules">
                {guide.rules.slice(0, 6).map((rule) => (
                  <li key={rule.indicator}>
                    <span
                      className={`econ-dot ${rule.currentFit == null ? 'tone-insufficient' : rule.currentFit >= 0.75 ? 'tone-supports' : rule.currentFit >= 0.4 ? 'tone-mixed' : 'tone-conflicts'}`}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{rule.label}</strong> <span className="muted">{rule.expects}</span>
                    </span>
                    <span className="sr-only">
                      {rule.currentFit == null ? 'no current reading' : rule.currentFit >= 0.75 ? 'met today' : rule.currentFit >= 0.4 ? 'partly met today' : 'not met today'}
                    </span>
                  </li>
                ))}
              </ul>
              <details className="econ-more">
                <summary>All {guide.rules.length} rules and weights</summary>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Indicator</th>
                      <th scope="col">Expects</th>
                      <th scope="col">Weight</th>
                      <th scope="col">Met today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guide.rules.map((rule) => (
                      <tr key={rule.indicator}>
                        <th scope="row">{rule.label}</th>
                        <td>{rule.expects}</td>
                        <td>{rule.weight.toFixed(1)}</td>
                        <td>{rule.currentFit == null ? 'No data' : `${Math.round(rule.currentFit * 100)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <p className="muted tiny">Dots: filled when today’s reading meets the rule, half when partly, hollow when not.</p>
            </div>
          </div>

          {guide.typical.length > 0 && guide.quartersInPhase > 0 ? (
            <details className="econ-more">
              <summary>Typical readings in past {guide.label} quarters</summary>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Indicator</th>
                    <th scope="col">Median</th>
                    <th scope="col">Quarters</th>
                  </tr>
                </thead>
                <tbody>
                  {guide.typical.map((row) => (
                    <tr key={row.indicator}>
                      <th scope="row">{row.label}</th>
                      <td>
                        {row.median.toFixed(row.unitSuffix === ' pp' ? 2 : 1)}
                        {row.unitSuffix}
                      </td>
                      <td>{row.quarters}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted tiny">{data.vintageNote}</p>
            </details>
          ) : null}

          <details className="econ-more">
            <summary>General asset-class tendencies in this phase</summary>
            <p className="muted tiny">
              Educational summary of patterns commonly described for this phase. It is not calculated from this app’s data and is not advice. See the asset explorer for figures this app can measure.
            </p>
            <ul className="econ-tendencies">
              {guide.assets.map((row) => (
                <li key={row.id}>
                  <span className={`tendency tendency-${row.tendency}`}>
                    {row.tendency === 'positive' ? '↑' : row.tendency === 'negative' ? '↓' : '→'} {row.label}
                  </span>
                  <span className="muted small">{row.explanation}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        <p id={panelId} className="muted">No guide is available.</p>
      )}
    </section>
  );
}
