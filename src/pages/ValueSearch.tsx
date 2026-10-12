import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import { useAuth } from '../auth/AuthContext';
import type { Holding } from '../lib/holdingDisplay';
import { loadMetalDisplayUnit, saveMetalDisplayUnit, type MetalDisplayUnit } from '../lib/metalUnits';
import { useDebouncedLookup } from '../lib/useDebouncedLookup';
import {
  detectQuery,
  formatCurrencyQuery,
  normalizeQuery,
  parseAs,
  visibleSearchTypes,
  type DetectContext,
  type SearchType,
} from '../lib/valueSearchDetect';
import {
  DEFAULT_W_PER_TH,
  lookupKey,
  runLookup,
  type CardRefine,
  type LookupInput,
} from '../lib/valueSearchLookup';
import {
  ownedShortcuts,
  pageSources,
  parseRecents,
  pushRecent,
  type SavedSearch,
} from '../lib/valueSearchView';
import type { CurrencyOption } from '../components/CurrencyPicker';
import { ValueSearchBox } from '../components/valueSearch/ValueSearchBox';
import { TypePicker, type TypeChoice } from '../components/valueSearch/TypePicker';
import { ResultCard } from '../components/valueSearch/ResultCard';
import { MetalSpotStrip } from '../components/valueSearch/MetalSpotStrip';
import { SavedSearches } from '../components/valueSearch/SavedSearches';

const PARSE_HINT: Record<SearchType, string> = {
  stock: 'Type a ticker, e.g. SPCX or AIR.NZ.',
  crypto: 'Type a coin symbol or name, e.g. BTC or bitcoin.',
  mtg: 'Type a card name or Scryfall id, e.g. Lightning Bolt.',
  pokemon: 'Type a card name or card id, e.g. Charizard or base1-4.',
  metal: 'Type a metal, e.g. silver 10 oz or gold 5g.',
  currency: 'Type currencies, e.g. 100 USD to NZD.',
  miner: 'Type a hashrate, e.g. 100 TH or 100 TH 15 W/TH.',
  diamond: 'Type a carat weight, e.g. 1.2 ct G VS1 round.',
};

const NO_CARD: CardRefine = { set: '', number: '', finish: '' };
const NO_MINER = { wPerTh: null as string | null, discountPct: null as string | null };

type Held = { stocks: string[]; crypto: string[]; wPerTh: number | null };

function heldFrom(holdings: Holding[]): Held {
  const held: Held = { stocks: [], crypto: [], wPerTh: null };
  for (const h of holdings) {
    if (h.assetClass === 'stock' && h.symbol) held.stocks.push(h.symbol);
    else if (h.assetClass === 'crypto' && h.asset) held.crypto.push(h.asset);
    else if (h.assetClass === 'gomining_miner' && held.wPerTh == null && h.energyEfficiencyWth) {
      held.wPerTh = h.energyEfficiencyWth;
    }
  }
  return held;
}

/** Recent searches are per account: several accounts can sign in on one browser. */
const recentsKey = (userId: string) => `valueSearch.recent.${userId}`;

function loadRecents(userId: string | null): SavedSearch[] {
  if (!userId) return [];
  try {
    return parseRecents(localStorage.getItem(recentsKey(userId)));
  } catch {
    return [];
  }
}

function saveRecents(userId: string | null, recents: SavedSearch[]): void {
  if (!userId) return;
  try {
    localStorage.setItem(recentsKey(userId), JSON.stringify(recents));
  } catch {
    /* ignore quota / private mode */
  }
}

/** A typed number, or null (use the default) when blank or out of range. */
function numberIn(raw: string | null, min: number, max: number): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function ValueSearch() {
  const { enabled, valueSearch } = useAssetClassPrefs();
  const userId = useAuth().user?.id ?? null;
  const types = useMemo(() => visibleSearchTypes(enabled, valueSearch), [enabled, valueSearch]);
  const metalVisible = types.includes('metal');

  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<TypeChoice>('auto');
  const [metalUnit, setMetalUnit] = useState<MetalDisplayUnit>(() => loadMetalDisplayUnit());
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[] | null>(null);
  const [currenciesFailed, setCurrenciesFailed] = useState(false);
  // Refinements belong to the query they were typed for; a new query starts clean.
  const [cardEdit, setCardEdit] = useState({ query: '', card: NO_CARD });
  const [minerEdit, setMinerEdit] = useState({ query: '', ...NO_MINER });
  const [settingsDiscount, setSettingsDiscount] = useState<number | null>(null);
  const [recents, setRecents] = useState<SavedSearch[]>(() => loadRecents(userId));
  const [metalProvider, setMetalProvider] = useState<string | null>(null);

  useEffect(() => {
    if (!metalVisible) return;
    let cancelled = false;
    api.quotes
      .metalsStatus()
      .then((status) => {
        if (!cancelled) setMetalProvider(status.provider);
      })
      // Without the status the sources line names the default provider.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [metalVisible]);

  useEffect(() => saveRecents(userId, recents), [userId, recents]);

  useEffect(() => {
    let cancelled = false;
    api.holdings
      .list()
      .then((rows) => {
        if (!cancelled) setHoldings(rows as Holding[]);
      })
      // Detection still works from the known lists and ticker shape without holdings.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const held = useMemo(() => heldFrom(holdings), [holdings]);

  const ctx: DetectContext = useMemo(
    () => ({ enabled: new Set(types), heldStocks: held.stocks, heldCrypto: held.crypto }),
    [types, held],
  );
  const activeChoice = choice !== 'auto' && !types.includes(choice) ? 'auto' : choice;
  const normalized = normalizeQuery(query);
  const parsed = useMemo(
    () => (activeChoice === 'auto' ? detectQuery(query, ctx) : parseAs(activeChoice, query, ctx)),
    [activeChoice, query, ctx],
  );

  const currencyInPlay = parsed?.type === 'currency';
  useEffect(() => {
    if (!currencyInPlay || currencies || currenciesFailed) return;
    let cancelled = false;
    api.quotes
      .fxCurrencies()
      .then((r) => {
        if (!cancelled) setCurrencies(r.currencies);
      })
      .catch(() => {
        if (!cancelled) setCurrenciesFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [currencyInPlay, currencies, currenciesFailed]);

  const unknownCurrencies = useMemo(() => {
    if (parsed?.type !== 'currency' || !currencies) return [];
    const known = new Set(currencies.map((c) => c.code));
    return (['from', 'to'] as const).filter((side) => !known.has(parsed[side]));
  }, [parsed, currencies]);

  const card = cardEdit.query === normalized ? cardEdit.card : NO_CARD;
  const miner = minerEdit.query === normalized ? minerEdit : { query: normalized, ...NO_MINER };

  const request = useMemo(() => {
    if (!parsed) return null;
    // Unrecognised codes never reach Frankfurter. Until the catalogue loads we can't tell,
    // so wait for it (or for it to fail, then let the server decide).
    if (parsed.type === 'currency' && (unknownCurrencies.length > 0 || (!currencies && !currenciesFailed))) {
      return null;
    }
    const input: LookupInput = {
      parsed,
      heldWPerTh: held.wPerTh,
      card: { set: card.set.trim(), number: card.number.trim(), finish: card.finish },
      miner: { wPerTh: numberIn(miner.wPerTh, 0.01, 1000), discountPct: numberIn(miner.discountPct, 0, 100) },
    };
    return { key: lookupKey(input), input: { ...input, query: normalized } };
  }, [parsed, normalized, held.wPerTh, card, miner.wPerTh, miner.discountPct, unknownCurrencies, currencies, currenciesFailed]);

  const { state, submit, runNext } = useDebouncedLookup({
    request,
    autoRun: normalized.length >= 2,
    run: runLookup,
    // A lookup that found something becomes a recent search; misses and errors don't.
    onResult: (input, result) => {
      if (result.status.kind === 'unavailable') return;
      setRecents((prev) => pushRecent(prev, { query: input.query, type: input.parsed.type }));
    },
  });

  // Remember the Settings discount from the last un-overridden miner lookup, so the input
  // keeps showing it while a lookup for an edited efficiency is in flight.
  const resultDiscount =
    state.status === 'done' && state.result.type === 'miner' && miner.discountPct == null
      ? state.result.discountPct
      : null;
  if (resultDiscount != null && resultDiscount !== settingsDiscount) setSettingsDiscount(resultDiscount);

  const shortcuts = useMemo(() => ownedShortcuts(holdings, types), [holdings, types]);
  const visibleRecents = recents.filter((r) => types.includes(r.type));
  const runSaved = (s: SavedSearch) => {
    // Same search already showing: nothing re-renders, so a pending runNext would wait for the next keystroke.
    if (s.query === query && s.type === activeChoice) return;
    setQuery(s.query);
    setChoice(s.type);
    runNext();
  };

  const hint =
    !normalized || parsed
      ? null
      : activeChoice === 'auto'
        ? 'None of your visible search types match this. Pick a type below.'
        : PARSE_HINT[activeChoice];

  if (types.length === 0) {
    return (
      <div className="stack value-search-page">
        <section className="panel">
          <h2 className="page-title">What's it worth?</h2>
          <p className="page-lead">
            No lookups are visible. Turn on an asset class (stocks, crypto, GoMining, metals, precious
            stones or collectables) or the currency exchanger in the account menu →{' '}
            <Link to="/settings">Settings</Link>.
          </p>
        </section>
      </div>
    );
  }

  const changeMetalUnit = (u: MetalDisplayUnit) => {
    setMetalUnit(u);
    saveMetalDisplayUnit(u);
  };
  const queryWPerTh = parsed?.type === 'miner' ? parsed.wPerTh : null;

  return (
    <div className="stack value-search-page">
      <header className="vs-header">
        <h2 className="page-title">What's it worth?</h2>
        <p className="page-lead">
          Check a live NZD value for a stock, coin, card, metal, currency or miner.
        </p>
        <ValueSearchBox value={query} onChange={setQuery} onSubmit={submit} />
        <TypePicker
          value={activeChoice}
          types={types}
          detected={activeChoice === 'auto' ? parsed?.type ?? null : null}
          onChange={setChoice}
        />
      </header>

      <ResultCard
        parsed={parsed}
        state={state}
        hint={hint}
        holdings={holdings}
        forexEnabled={enabled('forex')}
        controls={{
          metalUnit,
          onMetalUnitChange: changeMetalUnit,
          card,
          onCardChange: (next) => setCardEdit({ query: normalized, card: next }),
          miner: {
            wPerTh: miner.wPerTh ?? String(queryWPerTh ?? held.wPerTh ?? DEFAULT_W_PER_TH),
            discountPct: miner.discountPct ?? (settingsDiscount != null ? String(settingsDiscount) : ''),
            wPerThHint:
              miner.wPerTh != null
                ? 'Your figure'
                : queryWPerTh != null
                  ? 'From your search'
                  : held.wPerTh != null
                    ? 'From your first miner'
                    : 'Default',
          },
          onMinerChange: (field, value) => setMinerEdit({ ...miner, query: normalized, [field]: value }),
          currencies,
          unknownCurrencies,
          onCurrencyChange: (next) => {
            if (parsed?.type === 'currency') setQuery(formatCurrencyQuery({ ...parsed, ...next }));
          },
        }}
      />

      {!normalized ? <SavedSearches title="Things you own" searches={shortcuts} onRun={runSaved} /> : null}
      <SavedSearches
        title="Recent searches"
        searches={visibleRecents}
        onRun={runSaved}
        onClear={() => setRecents([])}
        clearLabel="Clear recent searches"
      />
      {!normalized && metalVisible ? <MetalSpotStrip unit={metalUnit} onUnitChange={changeMetalUnit} /> : null}

      <p className="muted small vs-sources">
        Sources: {pageSources(types, metalProvider).join(', ')}. Unavailable quotes show as unavailable, never guessed.
      </p>
    </div>
  );
}
