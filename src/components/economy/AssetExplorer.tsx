import { useState } from 'react';
import { shortPeriod } from '../../lib/economyView';
import type { EconomicAssetEvidence, EconomicCycleResponse, EconomicPhase, EconomicPhaseStat } from '../../types/economy';

function fmt(value: number | null, unit: string): string {
  if (value == null) return '—';
  const sign = unit !== '% p.a.' && value > 0 ? '+' : '';
  const text = `${sign}${value.toFixed(1)}`.replace('-', '−');
  return unit === 'pp' ? `${text} pp` : unit === '% p.a.' ? `${text}%` : `${text}%`;
}

function statCell(stat: EconomicPhaseStat | undefined, unit: string) {
  if (!stat || stat.quarters === 0) return <span className="muted">No quarters</span>;
  if (stat.median == null) return <span className="muted">n={stat.quarters}, too few</span>;
  return (
    <>
      <strong>{fmt(stat.median, unit)}</strong> <span className="muted tiny">n={stat.quarters}</span>
    </>
  );
}

export function AssetExplorer({ data }: { data: EconomicCycleResponse }) {
  const assets = data.assetEvidence;
  const [selected, setSelected] = useState<string[]>(() => {
    const available = assets.filter((row) => row.status === 'available').map((row) => row.id);
    return available.length > 0 ? available : assets.slice(0, 1).map((row) => row.id);
  });
  const current = data.phase?.id ?? null;
  const chosen = assets.filter((row) => selected.includes(row.id));
  const comparable = chosen.filter((row) => row.status === 'available');

  const toggle = (id: string) =>
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));

  return (
    <section className="panel econ-assets" aria-labelledby="econ-assets-title">
      <div className="panel-heading">
        <h2 id="econ-assets-title">Asset-class explorer</h2>
      </div>
      <p className="section-desc">
        How asset measures behaved in quarters the model placed in each phase. Only series stored by this app are used. Past patterns, not predictions or recommendations.
      </p>
      <div className="econ-chips" role="group" aria-label="Asset classes to compare">
        {assets.map((row) => (
          <button
            key={row.id}
            type="button"
            className={`econ-chip${selected.includes(row.id) ? ' is-on' : ''}`}
            aria-pressed={selected.includes(row.id)}
            onClick={() => toggle(row.id)}
          >
            {row.label}
            {row.status === 'unavailable' ? <span className="econ-chip-note"> · no data</span> : null}
          </button>
        ))}
      </div>

      {chosen.length === 0 ? <p className="muted small">Pick one or more asset classes.</p> : null}

      {comparable.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table econ-asset-table">
            <caption className="sr-only">Median by calculated phase for the selected asset classes</caption>
            <thead>
              <tr>
                <th scope="col">Phase</th>
                {comparable.flatMap((asset) =>
                  asset.metrics.map((metric) => (
                    <th key={`${asset.id}-${metric.id}`} scope="col">
                      {asset.label}
                      <span className="muted tiny econ-th-sub">{metric.label}</span>
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {(data.cycle.map((step) => step.id) as EconomicPhase[]).map((phase) => (
                <tr key={phase} className={phase === current ? 'is-current' : undefined}>
                  <th scope="row">
                    {data.cycle.find((step) => step.id === phase)?.label}
                    {phase === current ? <span className="econ-badge">Now</span> : null}
                  </th>
                  {comparable.flatMap((asset) =>
                    asset.metrics.map((metric) => (
                      <td key={`${asset.id}-${metric.id}`}>
                        {statCell(metric.byPhase.find((row) => row.phase === phase), metric.unit)}
                      </td>
                    )),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="econ-asset-grid">
        {chosen.map((asset) => (
          <AssetDetail key={asset.id} asset={asset} current={current} />
        ))}
      </div>
    </section>
  );
}

function AssetDetail({ asset, current }: { asset: EconomicAssetEvidence; current: EconomicPhase | null }) {
  if (asset.status === 'unavailable') {
    return (
      <article className="card econ-asset-card is-unavailable">
        <h3>{asset.label}</h3>
        <p className="econ-status tone-insufficient">
          <span aria-hidden="true">–</span> No historical dataset connected
        </p>
        <p className="small">
          <span className="muted">Needed: </span>
          {asset.requires}
        </p>
        {asset.caveats.map((text) => (
          <p key={text} className="muted tiny">
            {text}
          </p>
        ))}
        <p className="muted tiny">Related indicators on this page: {asset.relatedIndicators.join(', ')}.</p>
      </article>
    );
  }
  return (
    <article className="card econ-asset-card">
      <h3>{asset.label}</h3>
      <p className="muted tiny">
        {asset.dataset}
        {asset.coverage ? ` · ${shortPeriod(asset.coverage.from)} to ${shortPeriod(asset.coverage.to)}` : ''}
      </p>
      {asset.metrics.map((metric) => {
        const stat = metric.byPhase.find((row) => row.phase === current);
        return (
          <div key={metric.id} className="econ-asset-metric">
            <p className="small">
              {metric.label}
              {current && stat ? (
                <>
                  {' '}
                  in past {stat.label} quarters: {statCell(stat, metric.unit)}
                </>
              ) : null}
            </p>
            {stat && stat.median != null ? (
              <p className="muted tiny">
                Range {fmt(stat.min, metric.unit)} to {fmt(stat.max, metric.unit)}
                {stat.positiveShare != null && metric.unit !== '% p.a.' ? ` · above zero in ${stat.positiveShare}% of quarters` : ''}
                {stat.volatility != null ? ` · std. dev. ${stat.volatility.toFixed(1)}` : ''}
              </p>
            ) : null}
          </div>
        );
      })}
      {asset.drawdowns.length > 0 ? (
        <details className="econ-more">
          <summary>Falls of 10% or more ({asset.drawdowns.length})</summary>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Peak → trough</th>
                <th scope="col">Fall</th>
                <th scope="col">Back to peak</th>
              </tr>
            </thead>
            <tbody>
              {asset.drawdowns.map((row) => (
                <tr key={row.peakPeriod}>
                  <td>
                    {shortPeriod(row.peakPeriod)} → {shortPeriod(row.troughPeriod)}
                  </td>
                  <td>{row.depth.toFixed(1).replace('-', '−')}%</td>
                  <td>{row.recoveryQuarters != null ? `${row.recoveryQuarters} qtrs after trough` : 'Not yet'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : asset.id === 'shares' ? (
        <p className="muted tiny">No quarter-end fall of 10% or more in the stored period.</p>
      ) : null}
      <details className="econ-more">
        <summary>Dataset and limits</summary>
        <p className="tiny">
          <strong>Includes:</strong> {asset.includes.join(', ')}. <strong>Excludes:</strong> {asset.excludes.join(', ')}.
        </p>
        <ul className="econ-limits muted tiny">
          {asset.caveats.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}
