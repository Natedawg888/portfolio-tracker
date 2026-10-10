import { forwardRef } from 'react';
import { formatAuckland } from '../../api/client';
import { STATUS_META, formatChange, formatReading, shortPeriod } from '../../lib/economyView';
import type { EconomicIndicatorCard } from '../../types/economy';
import { IndicatorChart, Sparkline } from './IndicatorChart';

function sourceDate(iso: string | null): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-NZ', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1)),
    );
  }
  return formatAuckland(iso);
}

function shortSource(source: string | null): string {
  if (!source) return 'No source';
  return source.split(' — ')[0]!.split(',')[0]!;
}

export const IndicatorCard = forwardRef<
  HTMLElement,
  { card: EconomicIndicatorCard; expanded: boolean; onToggle: () => void; phaseLabel: string | null }
>(function IndicatorCard({ card, expanded, onToggle, phaseLabel }, ref) {
  const meta = STATUS_META[card.signal];
  const change = formatChange(card);
  const detailId = `econ-detail-${card.type}`;
  const headId = `econ-head-${card.type}`;

  return (
    <article
      ref={ref}
      className={`card econ-card tone-${meta.tone}${expanded ? ' is-expanded' : ''}${card.stale ? ' is-stale' : ''}`}
      aria-labelledby={headId}
    >
      {/* Mouse users can click the summary; the Details button is the keyboard and screen-reader control. */}
      <div className="econ-card-body" onClick={onToggle}>
        <div className="econ-card-top">
          <h3 id={headId}>{card.label}</h3>
          <span className={`econ-status tone-${meta.tone}`}>
            <span aria-hidden="true">{meta.icon}</span> {meta.label}
          </span>
        </div>
        {card.available ? (
          <>
            <p className="econ-card-value">
              <strong>{card.valueLabel}</strong>
              <span className={`econ-change dir-${change.direction}`}>
                {change.arrow ? <span aria-hidden="true">{change.arrow} </span> : null}
                {change.text}
                <span className="sr-only"> from the previous reading</span>
              </span>
            </p>
            <Sparkline points={card.history} label={`${card.label} trend`} />
            {card.summary ? <p className="econ-card-summary small">{card.summary}</p> : null}
            <p className="econ-card-meta muted tiny">
              {shortPeriod(card.period)} · {shortSource(card.source)}
              {card.stale ? <span className="econ-flag econ-flag--warn">Older print</span> : null}
              {card.derived ? <span className="econ-flag">Calculated</span> : null}
            </p>
          </>
        ) : (
          <p className="econ-card-summary small muted">No reading for this quarter. Nothing is filled in.</p>
        )}
      </div>
      <button
        type="button"
        className="econ-card-more"
        aria-expanded={expanded}
        aria-controls={detailId}
        aria-label={`${expanded ? 'Hide' : 'Show'} ${card.label} details`}
        onClick={onToggle}
      >
        {expanded ? 'Hide details' : 'Details'} <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded ? (
        <div id={detailId} className="econ-card-detail" role="region" aria-labelledby={headId}>
          {card.available ? (
            <>
              <IndicatorChart
                points={card.history}
                unit={card.unit}
                label={card.label}
                thresholds={card.thresholds}
              />
              <div className="econ-detail-grid">
                <dl className="econ-dl">
                  <dt>Latest</dt>
                  <dd>
                    {card.valueLabel} <span className="muted">· {shortPeriod(card.period)}</span>
                  </dd>
                  <dt>Previous</dt>
                  <dd>
                    {card.previousLabel ?? '—'}{' '}
                    <span className="muted">· {card.previousPeriod ? shortPeriod(card.previousPeriod) : 'no earlier reading'}</span>
                  </dd>
                  <dt>Model bands</dt>
                  <dd>
                    low below {formatReading(card.thresholds.lowBelow, card.unit)}, high above{' '}
                    {formatReading(card.thresholds.highAbove, card.unit)}; moves within ±{card.thresholds.flatBand} count as unchanged
                  </dd>
                </dl>
                <dl className="econ-dl">
                  <dt>{phaseLabel ? `${phaseLabel} expects` : 'Phase rule'}</dt>
                  <dd>{card.expects ?? 'Not scored'}</dd>
                  <dt>This reading</dt>
                  <dd>
                    {card.level ?? '—'}, {card.change === 'unknown' ? 'no change measured' : (card.change ?? '—')}
                  </dd>
                  <dt>Contribution</dt>
                  <dd>
                    {card.contribution != null && card.weight != null
                      ? `${card.contribution.toFixed(2)} of a possible ${card.weight.toFixed(1)} (fit ${card.score ?? 0}%)`
                      : '—'}
                  </dd>
                </dl>
              </div>

              <h4 className="econ-subhead">Method</h4>
              <p className="small">{card.description}</p>
              {card.notes ? <p className="muted small">{card.notes}</p> : null}

              <h4 className="econ-subhead">Provenance</h4>
              <dl className="econ-dl econ-dl--inline">
                <dt>Observation period</dt>
                <dd>{card.periodLabel ?? '—'}</dd>
                <dt>Published</dt>
                <dd>
                  {card.publishedAtPrecision === 'release'
                    ? sourceDate(card.publishedAt)
                    : `Not in the source extract (period ends ${sourceDate(card.periodEnd)})`}
                </dd>
                <dt>Retrieved</dt>
                <dd>{formatAuckland(card.retrievedAt)}</dd>
                <dt>Source</dt>
                <dd>
                  {card.sourceUrl ? (
                    <a href={card.sourceUrl} target="_blank" rel="noreferrer">
                      {card.source}
                    </a>
                  ) : (
                    (card.source ?? '—')
                  )}
                </dd>
                <dt>Value type</dt>
                <dd>{card.derived ? 'Calculated in this app from a published series' : 'As published'}</dd>
              </dl>
              {card.stale ? (
                <p className="econ-warning small">
                  <span aria-hidden="true">⚠ </span>This print is older than usual for a {card.frequency ?? ''} series. It is not described as a current figure.
                </p>
              ) : null}

              {card.history.length > 0 ? (
                <details className="econ-more">
                  <summary>Readings table ({card.history.length})</summary>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Period</th>
                        <th scope="col">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...card.history].reverse().map((point) => (
                        <tr key={point.period}>
                          <td>{shortPeriod(point.period)}</td>
                          <td>{formatReading(point.value, card.unit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
            </>
          ) : (
            <>
              <p className="small">{card.description}</p>
              <p className="econ-warning small">
                <span aria-hidden="true">⚠ </span>The provider returned no observation for this quarter. The card stays blank and the indicator is left out of the score.
              </p>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
});
