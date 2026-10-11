/**
 * Metals: one spot block per metal held (NZD per oz t, 1M change, one price
 * chart), then the holdings (name, weight, cost and return, value).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, formatAuckland, formatNzd } from '../../api/client';
import { HoldingPriceChart } from '../HoldingPriceChart';
import { InfoTip } from '../InfoTip';
import { MoreMenu } from '../MoreMenu';
import { AddCostButton } from './AddCostButton';
import { amountLabel, displayCostBasisNzd, displayName, marketValueNzd, type Holding } from '../../lib/holdingDisplay';
import { formatSignedPct, holdingReturn, seriesChangePct } from '../../lib/portfolioView';

const changeCache = new Map<string, Promise<number | null>>();

function metalMonthChange(metal: string): Promise<number | null> {
  let p = changeCache.get(metal);
  if (!p) {
    p = api.quotes
      .history({ assetClass: 'metal', metal, range: '1m' })
      .then((r) => (r.status === 'ok' ? seriesChangePct(r.points) : null))
      .catch(() => null);
    changeCache.set(metal, p);
  }
  return p;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function SpotBlock({ metal, holding }: { metal: string; holding: Holding }) {
  const [change, setChange] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void metalMonthChange(metal).then((v) => {
      if (live) setChange(v);
    });
    return () => {
      live = false;
    };
  }, [metal]);
  return (
    <section className="card metal-spot" aria-label={`${titleCase(metal)} spot price`}>
      <div className="metal-spot-head">
        <h4>{titleCase(metal)}</h4>
        <p className="metal-spot-price money">
          {holding.spotPriceNzdPerOzT != null ? `${formatNzd(holding.spotPriceNzdPerOzT)} / oz t` : '— / oz t'}
        </p>
        <p className="small">
          <span className="muted">1M </span>
          {change === undefined ? (
            <span className="muted">…</span>
          ) : change == null ? (
            <span className="muted">—</span>
          ) : (
            <span className={change >= 0 ? 'return-pos' : 'return-neg'}>{formatSignedPct(change)}</span>
          )}
          {holding.spotAsOf ? <span className="muted"> · {formatAuckland(holding.spotAsOf)}</span> : null}
        </p>
      </div>
      <HoldingPriceChart assetClass="metal" metal={metal} />
    </section>
  );
}

export function MetalsTab({
  holdings,
  sourceInfo,
  onRefresh,
  onDelete,
  onSetCost,
  children,
}: {
  holdings: Holding[];
  sourceInfo: ReactNode;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onSetCost: (id: string, costNzd: number) => Promise<boolean>;
  children?: ReactNode;
}) {
  const byMetal = new Map<string, Holding>();
  for (const h of holdings) {
    if (h.metal && !byMetal.has(h.metal)) byMetal.set(h.metal, h);
  }

  return (
    <section className="panel" aria-labelledby="metals-title">
      <div className="panel-heading">
        <h3 id="metals-title">
          Metals
          <InfoTip label="Where metal prices come from">{sourceInfo}</InfoTip>
        </h3>
      </div>
      {byMetal.size > 0 ? (
        <div className="metal-spots">
          {[...byMetal].map(([metal, h]) => (
            <SpotBlock key={metal} metal={metal} holding={h} />
          ))}
        </div>
      ) : null}
      {holdings.length === 0 ? (
        <p className="muted">No metal holdings yet.</p>
      ) : (
        <ul className="asset-list asset-list--metals">
          <li className="asset-list-head" aria-hidden="true">
            <span>Holding</span>
            <span>Cost</span>
            <span>Return</span>
            <span>Value</span>
            <span />
          </li>
          {holdings.map((h) => {
            const value = marketValueNzd(h);
            const cost = displayCostBasisNzd(h);
            const ret = holdingReturn(value, cost);
            return (
              <li key={h.id} className="asset-row">
                <div className="asset-row-hit asset-row-static">
                  <span className="asset-row-name">
                    <span className="asset-row-title">{displayName(h)}</span>
                    <span className="muted small">{amountLabel(h)}</span>
                  </span>
                  <span className="asset-row-num small">
                    {cost != null && cost > 0 ? (
                      formatNzd(cost)
                    ) : (
                      <AddCostButton name={displayName(h)} onSave={(c) => onSetCost(h.id, c)} />
                    )}
                  </span>
                  <span className="asset-row-num small">
                    {ret.kind === 'ok' ? (
                      <span className={ret.pct >= 0 ? 'return-pos' : 'return-neg'}>{formatSignedPct(ret.pct)}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </span>
                  <span className="money">{formatNzd(value)}</span>
                  <MoreMenu label={`More actions for ${displayName(h)}`}>
                    {(close) => (
                      <>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            close();
                            onRefresh(h.id);
                          }}
                        >
                          Refresh value
                        </button>
                        <button
                          type="button"
                          className="btn small danger"
                          onClick={() => {
                            close();
                            onDelete(h.id);
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </MoreMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {children}
    </section>
  );
}
