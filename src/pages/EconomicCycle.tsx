import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { abandonPageRead, beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { usePageCacheValue } from '../lib/usePageCache';
import { AssetExplorer } from '../components/economy/AssetExplorer';
import { CycleOverview } from '../components/economy/CycleOverview';
import { EconomyNews } from '../components/economy/EconomyNews';
import { IndicatorCard } from '../components/economy/IndicatorCard';
import { PhaseExplorer } from '../components/economy/PhaseExplorer';
import { PhaseHistory } from '../components/economy/PhaseHistory';
import { ScenarioSimulator } from '../components/economy/ScenarioSimulator';
import type { MixState } from '../components/economy/YourMix';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import { cycleMix, type NetWorthTotals } from '../lib/cycleMix';
import type { EconomicCycleResponse } from '../types/economy';
import { isCurrentCycleRequest, nextCycleLoad, shouldApplyCyclePayload } from './cycleLoad';

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

function economyKey(country: string): string {
  return `economy:${country}`;
}

/** The user's net worth for "Your mix". In the portfolio scope, so holding edits refresh it. */
const MIX_KEY = 'cycle-mix';

/** Loads the signed-in user's class totals (stale-while-revalidate) for the mix panel. */
function useMixState(): MixState {
  const { enabled } = useAssetClassPrefs();
  const cached = usePageCacheValue<NetWorthTotals>(MIX_KEY);
  const [failed, setFailed] = useState(false);
  // Fetch on every visit, and again when an edit elsewhere clears the cached mix.
  const missing = cached == null;
  useEffect(() => {
    let cancelled = false;
    const stamp = beginPageRead(MIX_KEY);
    api
      .netWorth()
      .then((nw) => {
        if (!commitPageRead(stamp, nw as NetWorthTotals) || cancelled) return;
        setFailed(false);
      })
      .catch(() => {
        abandonPageRead(stamp);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [missing]);
  if (cached) return { status: 'ready', mix: cycleMix(cached, (pref) => enabled(pref as Parameters<typeof enabled>[0])) };
  return failed ? { status: 'error' } : { status: 'loading' };
}

export function EconomicCycle() {
  const [country, setCountry] = useState('NZ');
  const initialCycle = readPageCache<EconomicCycleResponse>(economyKey('NZ'));
  const cachedCycle = usePageCacheValue<EconomicCycleResponse>(economyKey(country));
  const [data, setData] = useState<EconomicCycleResponse | null>(initialCycle ?? null);
  const resolved =
    (data?.country === country ? data : null) ??
    (cachedCycle?.country === country ? cachedCycle : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialCycle == null);
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const mix = useMixState();

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
        // Keep the extract even if this page has unmounted or a newer load
        // started. Leaving the page must not throw the response away.
        if (payload.country === ticket.country) commitPageRead(stamp, payload);
        else abandonPageRead(stamp);
        if (!mountedRef.current || !isCurrentCycleRequest(ticket, requestSeq.current)) return;
        if (!shouldApplyCyclePayload(ticket, requestSeq.current, payload.country)) {
          setError('The extract was for a different country, so it was not shown.');
          return;
        }
        setData(payload);
        setError(null);
      })
      .catch((err: Error) => {
        abandonPageRead(stamp);
        if (!mountedRef.current || !isCurrentCycleRequest(ticket, requestSeq.current) || controller.signal.aborted) return;
        setError(err.message);
      })
      .finally(() => {
        if (mountedRef.current && isCurrentCycleRequest(ticket, requestSeq.current)) setLoading(false);
      });
  }, [country]);

  useEffect(() => {
    mountedRef.current = true;
    void load(false);
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const changeCountry = (next: string) => {
    const cached = readPageCache<EconomicCycleResponse>(economyKey(next));
    if (cached?.country === next) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setExpanded(new Set());
    setCountry(next);
  };

  if (error && !resolved) {
    return (
      <div className="panel warn econ-page">
        <h2 className="page-title">Economic cycle</h2>
        <p>{error}</p>
      </div>
    );
  }

  const options = resolved?.countries?.length
    ? resolved.countries
    : [
        { code: 'NZ', name: 'New Zealand' },
        { code: 'US', name: 'United States' },
      ];
  const selectedName = options.find((option) => option.code === country)?.name ?? country;
  const showing = resolved;

  if (!showing) {
    return (
      <div className="panel econ-page">
        <CountryControl
          country={country}
          options={options}
          disabled={loading}
          onChange={changeCountry}
        />
        <h2 className="page-title">Economic cycle</h2>
        {error ? (
          <p>{error}</p>
        ) : loading ? (
          <div aria-busy="true">
            <p className="muted">Loading {selectedName} indicator extracts. The first load can take a minute.</p>
            <div className="econ-skeleton-grid" aria-hidden="true">
              {[0, 1, 2, 3].map((n) => (
                <span key={n} className="econ-skeleton" />
              ))}
            </div>
          </div>
        ) : (
          <p className="muted">No {selectedName} extract is on screen.</p>
        )}
      </div>
    );
  }

  const phase = showing.phase;
  const toggleCard = (type: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  const showIndicator = (type: string) => {
    setExpanded((prev) => new Set(prev).add(type));
    window.requestAnimationFrame(() => {
      const el = cardRefs.current.get(type);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector<HTMLButtonElement>('.econ-card-more')?.focus({ preventScroll: true });
    });
  };
  const dataKey = `${showing.country}:${showing.lastUpdated ?? 'none'}:${phase?.id ?? 'none'}`;

  return (
    <div className="stack econ-page">
      {showing.provider.kind === 'sample' ? (
        <div className="panel warn" role="status">
          <h2>Sample data — not live</h2>
          <p>
            These figures are a labelled fixture, not official statistics, and they are not current. Set the provider back to the public extracts to leave this mode.
          </p>
        </div>
      ) : null}
      {showing.refreshError ? (
        <div className="panel warn" role="alert">
          <p>Refresh failed: {showing.refreshError} The figures below are the last stored extract.</p>
        </div>
      ) : null}
      {error && resolved ? (
        <div className="panel warn" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <CycleOverview
        data={showing}
        loading={loading}
        onRefresh={() => {
          setLoading(true);
          void load(true);
        }}
        onShowIndicator={showIndicator}
        controls={<CountryControl country={country} options={options} disabled={loading} onChange={changeCountry} />}
      />

      <PhaseExplorer key={`explore:${dataKey}`} data={showing} mix={mix} />

      <section className="panel econ-indicators" aria-labelledby="econ-indicators-title">
        <div className="panel-heading">
          <h2 id="econ-indicators-title">Indicators</h2>
          <button
            type="button"
            className="btn small ghost"
            onClick={() =>
              setExpanded((prev) => (prev.size > 0 ? new Set() : new Set(showing.indicators.map((card) => card.type))))
            }
          >
            {expanded.size > 0 ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
        <p className="section-desc">
          Status compares each reading with the {phase ? phase.label : 'calculated'} phase rules. Open a card for its chart, scoring and source.
        </p>
        <div className="econ-card-grid">
          {showing.indicators.map((card) => (
            <IndicatorCard
              key={card.type}
              ref={(el) => {
                if (el) cardRefs.current.set(card.type, el);
                else cardRefs.current.delete(card.type);
              }}
              card={card}
              phaseLabel={phase?.label ?? null}
              expanded={expanded.has(card.type)}
              onToggle={() => toggleCard(card.type)}
            />
          ))}
        </div>
      </section>

      <AssetExplorer key={`assets:${dataKey}`} data={showing} />

      <ScenarioSimulator key={`scenario:${dataKey}`} data={showing} />

      <EconomyNews key={`${country}:${phase?.id ?? 'none'}`} phase={phase?.id ?? null} country={country} indicators={showing.indicators} />

      <PhaseHistory data={showing} />

      <footer className="econ-footnote muted tiny">
        {showing.coverageNote ? <p>{showing.coverageNote}</p> : null}
        <p>
          {showing.provider.label} · model v{showing.modelVersion}
        </p>
        <p>{showing.disclaimer}</p>
      </footer>
    </div>
  );
}
