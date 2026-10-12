import { useCallback, useEffect, useState } from 'react';
import { api, formatAuckland, formatNzd } from '../../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../../lib/pageDataCache';
import { metalUnitLabel, nzdPerOzToDisplay, type MetalDisplayUnit } from '../../lib/metalUnits';

type MetalQuote = Awaited<ReturnType<typeof api.quotes.metals>>['quotes'][number];

const METALS_KEY = 'value-search:metals';

/** Compact spot list shown under an empty search box. */
export function MetalSpotStrip({
  unit,
  onUnitChange,
}: {
  unit: MetalDisplayUnit;
  onUnitChange: (unit: MetalDisplayUnit) => void;
}) {
  const [quotes, setQuotes] = useState<MetalQuote[]>(() => readPageCache<MetalQuote[]>(METALS_KEY) ?? []);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback((force: boolean) => {
    const stamp = beginPageRead(METALS_KEY);
    (force ? api.quotes.refreshMetals() : api.quotes.metals(false))
      .then((data) => {
        if (!commitPageRead(stamp, data.quotes)) return;
        setQuotes(data.quotes);
        setMsg(null);
      })
      .catch((err: Error) => setMsg(err.message))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <section className="panel vs-metal-strip" aria-label="Spot prices">
      <div className="vs-metal-strip-head">
        <h3>Spot prices · {metalUnitLabel(unit)}</h3>
        <div className="row gap">
          <div className="segmented segmented--small" role="group" aria-label="Metal price unit">
            {(['oz_t', 'g'] as const).map((u) => (
              <button
                key={u}
                type="button"
                className={'segmented-btn' + (unit === u ? ' active' : '')}
                aria-pressed={unit === u}
                onClick={() => onUnitChange(u)}
              >
                {u === 'oz_t' ? 'oz t' : 'gram'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn small"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              load(true);
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {msg ? <p className="banner">{msg}</p> : null}
      {quotes.length === 0 && !msg ? <p className="muted small">Loading spot prices…</p> : null}
      <ul className="vs-metal-list">
        {quotes.map((q) => {
          const usable = q.price != null && (q.status === 'ok' || q.status === 'stale');
          return (
            <li key={q.metal}>
              <span className="vs-metal-name">{q.metal}</span>
              {usable ? (
                <span className="money">{formatNzd(nzdPerOzToDisplay(q.price, unit))}</span>
              ) : (
                <span className="vs-status-unavailable">Unavailable from {q.source}</span>
              )}
              {q.status === 'stale' ? (
                <span className="small vs-status-stale">Stale · as of {formatAuckland(q.asOf)}</span>
              ) : usable ? (
                <span className="muted small">{formatAuckland(q.asOf)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
