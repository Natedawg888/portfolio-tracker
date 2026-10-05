import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAuckland, formatMoney, formatNzd } from '../api/client';
import { CurrencyPicker, type CurrencyOption } from '../components/CurrencyPicker';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import type { AssetClassPrefKey } from '../lib/assetClassPrefs';
import {
  estimateMinerEarnings,
  formatBtc,
  formatEarningsAmount,
  type BtcFxRates,
  type EarningsDisplayCurrency,
  type GoMiningEarningsEstimate,
  type GoMiningNetworkParams,
} from '../lib/gominingEarnings';
import {
  loadMetalDisplayUnit,
  saveMetalDisplayUnit,
  metalUnitLabel,
  nzdPerOzToDisplay,
  type MetalDisplayUnit,
} from '../lib/metalUnits';

type MetalQuote = {
  metal: string;
  assetKey: string;
  currency: string;
  price: number | null;
  status: string;
  source: string;
  asOf: string | null;
  message?: string | null;
};

const DIAMOND_COLOURS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
const DIAMOND_CLARITIES = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
const DIAMOND_SHAPES = [
  'round',
  'cushion',
  'radiant',
  'emerald',
  'oval',
  'pear',
  'marquise',
  'heart',
];

const MTG_FINISHES = ['nonfoil', 'foil', 'etched'];
const POKEMON_FINISHES = ['holofoil', 'reverseHolofoil', 'normal'];

/** Pref keys that unlock at least one Value Search tool (asset classes). */
const VALUE_SEARCH_PREF_KEYS: AssetClassPrefKey[] = [
  'stock',
  'crypto',
  'gomining',
  'metal',
  'stone',
  'collectable',
];

type TickerResult = {
  ticker: string;
  name: string;
  quoteAvailable: boolean;
  quote: {
    price: number | null;
    status: string;
    source: string;
    asOf: string | null;
    message?: string | null;
  };
  iconUrl?: string | null;
};

type CardResult = Awaited<ReturnType<typeof api.quotes.cardQuote>>['quote'];

type FxResult = Awaited<ReturnType<typeof api.quotes.fx>>;

function parseOptNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function ValueSearch() {
  const { enabled, valueSearch } = useAssetClassPrefs();
  const showStock = enabled('stock');
  const showCrypto = enabled('crypto');
  const showGomining = enabled('gomining');
  const showMetal = enabled('metal');
  /** Currency exchanger is a separate Value Search pref — not gated by Forex asset class. */
  const showCurrencyExchanger = valueSearch.showCurrencyExchanger !== false;
  const showStone = enabled('stone');
  const showCollectable = enabled('collectable');
  const anyTool =
    VALUE_SEARCH_PREF_KEYS.some((k) => enabled(k)) || showCurrencyExchanger;

  // --- Metals ---
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [quotes, setQuotes] = useState<MetalQuote[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [metalUnit, setMetalUnit] = useState<MetalDisplayUnit>(() => loadMetalDisplayUnit());
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  // --- Diamond ---
  const [diamondForm, setDiamondForm] = useState({
    carat: '1.0',
    colour: 'G',
    clarity: 'VS2',
    shape: 'round',
  });
  const [diamondLoading, setDiamondLoading] = useState(false);
  const [diamondMsg, setDiamondMsg] = useState<string | null>(null);
  const [diamondQuote, setDiamondQuote] = useState<{
    price: number | null;
    status: string;
    source: string;
    asOf: string | null;
    message?: string | null;
    assetKey?: string;
  } | null>(null);

  // --- Stock / crypto tickers ---
  const [stockTicker, setStockTicker] = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [stockMsg, setStockMsg] = useState<string | null>(null);
  const [stockResult, setStockResult] = useState<TickerResult | null>(null);

  const [cryptoTicker, setCryptoTicker] = useState('');
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [cryptoMsg, setCryptoMsg] = useState<string | null>(null);
  const [cryptoResult, setCryptoResult] = useState<TickerResult | null>(null);

  // --- Cards ---
  const [mtgForm, setMtgForm] = useState({
    name: '',
    set: '',
    number: '',
    finish: 'nonfoil',
    apiId: '',
  });
  const [mtgLoading, setMtgLoading] = useState(false);
  const [mtgMsg, setMtgMsg] = useState<string | null>(null);
  const [mtgResult, setMtgResult] = useState<CardResult | null>(null);

  const [pokeForm, setPokeForm] = useState({
    name: '',
    set: '',
    number: '',
    finish: 'holofoil',
    apiId: '',
  });
  const [pokeLoading, setPokeLoading] = useState(false);
  const [pokeMsg, setPokeMsg] = useState<string | null>(null);
  const [pokeResult, setPokeResult] = useState<CardResult | null>(null);

  // --- FX (any → any) ---
  const [fxForm, setFxForm] = useState({ from: 'NZD', to: 'JPY', amount: '100' });
  const [fxCurrencies, setFxCurrencies] = useState<CurrencyOption[]>([]);
  const [fxCurrenciesMsg, setFxCurrenciesMsg] = useState<string | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxMsg, setFxMsg] = useState<string | null>(null);
  const [fxResult, setFxResult] = useState<FxResult | null>(null);

  // --- GoMining calculator ---
  const [minerForm, setMinerForm] = useState({
    hashrateThs: '100',
    energyEfficiencyWth: '20',
    discountPct: '0',
  });
  const [minerLoading, setMinerLoading] = useState(false);
  const [minerMsg, setMinerMsg] = useState<string | null>(null);
  const [minerEstimate, setMinerEstimate] = useState<GoMiningEarningsEstimate | null>(null);
  const [minerFxNote, setMinerFxNote] = useState<string | null>(null);
  const [minerDisplay, setMinerDisplay] = useState<EarningsDisplayCurrency>('NZD');

  const loadMetals = useCallback(async (force = false) => {
    setLoading(true);
    setMsg(null);
    try {
      const status = await api.quotes.metalsStatus();
      setConfigured(status.configured);
      setQuotaBlocked(Boolean((status as { quotaBlocked?: boolean }).quotaBlocked));
      setQuotaMessage((status as { quotaMessage?: string | null }).quotaMessage ?? null);
      const data = force
        ? await api.quotes.refreshMetals()
        : await api.quotes.metals(false);
      setQuotes(data.quotes);
      const qb = Boolean((data as { quotaBlocked?: boolean }).quotaBlocked);
      const qm = (data as { quotaMessage?: string | null }).quotaMessage ?? null;
      setQuotaBlocked(qb);
      setQuotaMessage(qm);
      if (force) {
        const usable = data.quotes.filter(
          (q) => (q.status === 'ok' || q.status === 'stale') && q.price != null,
        ).length;
        const stale = data.quotes.filter((q) => q.status === 'stale').length;
        if (!status.configured && usable === data.quotes.length) {
          setMsg(`Refreshed ${usable}/${data.quotes.length} metals from gold-api.com (NZD/oz t).`);
        } else if (!status.configured) {
          setMsg(
            `gold-api.com returned ${usable}/${data.quotes.length} usable NZD spots (never invent).`,
          );
        } else if (usable === data.quotes.length && stale > 0) {
          setMsg(
            qm ??
              `Showing last-good Metals.Dev NZD spots (${usable}/${data.quotes.length}, stale — quota/API). Never invented.`,
          );
        } else if (usable === data.quotes.length) {
          setMsg(`Refreshed ${usable}/${data.quotes.length} metals from Metals.Dev (NZD/oz t).`);
        } else {
          setMsg(
            qm ??
              `Metals.Dev returned ${usable}/${data.quotes.length} usable quotes (never invent).`,
          );
        }
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showMetal) void loadMetals(false);
  }, [loadMetals, showMetal]);

  useEffect(() => {
    if (!showCurrencyExchanger) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.quotes.fxCurrencies(false);
        if (cancelled) return;
        setFxCurrencies(data.currencies);
        if (data.message) setFxCurrenciesMsg(data.message);
      } catch (err) {
        if (!cancelled) {
          setFxCurrenciesMsg((err as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showCurrencyExchanger]);

  async function onDiamondQuote(e: FormEvent) {
    e.preventDefault();
    setDiamondLoading(true);
    setDiamondMsg(null);
    setDiamondQuote(null);
    try {
      const carat = Number(diamondForm.carat);
      if (!Number.isFinite(carat) || carat < 0.3 || carat > 6) {
        setDiamondMsg('Carat must be between 0.3 and 6.0 for OpenFacet');
        return;
      }
      const data = await api.quotes.diamondQuote({
        carat,
        colour: diamondForm.colour,
        clarity: diamondForm.clarity,
        shape: diamondForm.shape,
        force: true,
      });
      setDiamondQuote(data.quote);
      setDiamondMsg(
        data.quote.status === 'ok'
          ? `OpenFacet → NZD (source ${data.quote.source})`
          : data.quote.message ?? 'Quote unavailable — never invent',
      );
    } catch (err) {
      setDiamondMsg((err as Error).message);
    } finally {
      setDiamondLoading(false);
    }
  }

  async function onStockCheck(e: FormEvent) {
    e.preventDefault();
    const ticker = stockTicker.trim().toUpperCase();
    if (!ticker) {
      setStockMsg('Enter a ticker symbol');
      return;
    }
    setStockLoading(true);
    setStockMsg(null);
    setStockResult(null);
    try {
      const r = await api.quotes.resolveTicker(ticker, 'stock');
      setStockResult({
        ticker: r.ticker,
        name: r.name,
        quoteAvailable: r.quoteAvailable,
        quote: r.quote,
        iconUrl: r.iconUrl,
      });
      setStockMsg(
        r.quoteAvailable && r.quote.price != null
          ? `${r.name} · Yahoo ${formatNzd(r.quote.price)} / share`
          : r.quote.message ??
              'Equity quote unavailable — never invent. Portfolio may still show Akahu / cost.',
      );
    } catch (err) {
      setStockMsg((err as Error).message);
    } finally {
      setStockLoading(false);
    }
  }

  async function onCryptoCheck(e: FormEvent) {
    e.preventDefault();
    const ticker = cryptoTicker.trim().toUpperCase();
    if (!ticker) {
      setCryptoMsg('Enter a ticker (e.g. BTC)');
      return;
    }
    setCryptoLoading(true);
    setCryptoMsg(null);
    setCryptoResult(null);
    try {
      const r = await api.quotes.resolveTicker(ticker, 'crypto');
      setCryptoResult({
        ticker: r.ticker,
        name: r.name,
        quoteAvailable: r.quoteAvailable,
        quote: r.quote,
        iconUrl: r.iconUrl,
      });
      setCryptoMsg(
        r.quoteAvailable && r.quote.price != null
          ? `${r.name} · CoinGecko ${formatNzd(r.quote.price)} / unit`
          : r.quote.message ?? 'Quote unavailable — never invent',
      );
    } catch (err) {
      setCryptoMsg((err as Error).message);
    } finally {
      setCryptoLoading(false);
    }
  }

  async function onCardCheck(
    e: FormEvent,
    game: 'mtg' | 'pokemon',
  ) {
    e.preventDefault();
    const form = game === 'mtg' ? mtgForm : pokeForm;
    const setLoadingFn = game === 'mtg' ? setMtgLoading : setPokeLoading;
    const setMsgFn = game === 'mtg' ? setMtgMsg : setPokeMsg;
    const setResultFn = game === 'mtg' ? setMtgResult : setPokeResult;

    if (!form.apiId.trim() && !form.name.trim() && !(form.set.trim() && form.number.trim())) {
      setMsgFn('Provide name, set+number, or API id');
      return;
    }
    setLoadingFn(true);
    setMsgFn(null);
    setResultFn(null);
    try {
      const data = await api.quotes.cardQuote({
        game,
        name: form.name.trim() || undefined,
        set: form.set.trim() || undefined,
        number: form.number.trim() || undefined,
        finish: form.finish || undefined,
        apiId: form.apiId.trim() || undefined,
      });
      setResultFn(data.quote);
      setMsgFn(
        data.quote.status === 'ok' && data.quote.unitNzd != null
          ? `${data.quote.name} · ${formatNzd(data.quote.unitNzd)} (${data.quote.source})`
          : data.quote.message ?? 'Quote unavailable — never invent',
      );
    } catch (err) {
      setMsgFn((err as Error).message);
    } finally {
      setLoadingFn(false);
    }
  }

  async function onFxConvert(e: FormEvent) {
    e.preventDefault();
    const from = fxForm.from.trim().toUpperCase();
    const to = fxForm.to.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      setFxMsg('Pick From and To currencies (3-letter ISO)');
      return;
    }
    const amount = parseOptNum(fxForm.amount);
    setFxLoading(true);
    setFxMsg(null);
    setFxResult(null);
    try {
      const data = await api.quotes.fx({
        from,
        to,
        amount: amount ?? undefined,
        force: true,
      });
      setFxResult(data);
      if (data.status === 'ok' && data.rate != null) {
        if (data.convertedAmount != null && data.amount != null) {
          setFxMsg(
            `${data.amount} ${from} → ${formatMoney(data.convertedAmount, to)} @ ${data.rate} (${data.source})`,
          );
        } else {
          setFxMsg(`1 ${from} = ${data.rate} ${to} (${data.source})`);
        }
      } else {
        setFxMsg(data.message ?? 'FX unavailable — never invent');
      }
    } catch (err) {
      setFxMsg((err as Error).message);
    } finally {
      setFxLoading(false);
    }
  }

  function swapFxCurrencies() {
    setFxForm((prev) => ({ ...prev, from: prev.to, to: prev.from }));
    setFxResult(null);
    setFxMsg(null);
  }

  async function onMinerCalc(e: FormEvent) {
    e.preventDefault();
    const th = Number(minerForm.hashrateThs);
    if (!Number.isFinite(th) || th <= 0) {
      setMinerMsg('Hashrate (TH/s) required');
      return;
    }
    setMinerLoading(true);
    setMinerMsg(null);
    setMinerEstimate(null);
    setMinerFxNote(null);
    try {
      const g = await api.settings.getGomining();
      const discountPct =
        parseOptNum(minerForm.discountPct) ?? Number(g.discountPct) ?? 0;
      const ee = parseOptNum(minerForm.energyEfficiencyWth);

      const courseBtc =
        g.income?.status === 'ok' ? g.income.btcCourseInUsd ?? null : null;
      const poolBtc =
        g.income?.status === 'ok' ? g.income.poolIncomeBtcPerTh ?? null : null;
      const poolUsd =
        g.income?.status === 'ok' ? g.income.poolIncomeUsdPerTh ?? null : null;
      const gbpSat =
        g.income?.status === 'ok' ? g.income.goBtcPaySatPerTh ?? null : null;
      const gbpBtc =
        g.income?.status === 'ok' ? g.income.goBtcPayBtcPerTh ?? null : null;
      const impliedKwh =
        g.income?.status === 'ok' ? g.income.impliedKwhCostUsd ?? null : null;
      const liveEhs =
        g.effective?.networkHashrateEhs ??
        (g.networkHashrate?.status === 'ok'
          ? g.networkHashrate.networkHashrateEhs
          : null);

      const network: GoMiningNetworkParams = {
        btcUsd: g.btcUsd ?? courseBtc,
        poolIncomeUsdPerTh: poolUsd,
        poolIncomeBtcPerTh: poolBtc,
        goBtcPaySatPerTh: gbpSat,
        goBtcPayBtcPerTh: gbpBtc,
        networkHashrateEhs: g.networkHashrateEhs ?? liveEhs,
        dailyBtcIssuance: g.dailyBtcIssuance,
        kWhCostUsd: g.kWhCostUsd ?? impliedKwh,
      };

      const fx: BtcFxRates | null = g.fx
        ? {
            btcUsd: g.fx.btcUsd,
            btcNzd: g.fx.btcNzd,
            source: g.fx.source,
            asOf: g.fx.asOf,
            status: g.fx.status,
            message: g.fx.message,
          }
        : null;

      const estimate = estimateMinerEarnings({
        hashrateThs: th,
        energyEfficiencyWth: ee,
        discountPct,
        network,
        fx,
      });
      setMinerEstimate(estimate);

      const fxBits: string[] = [];
      if (fx?.status === 'ok') {
        if (fx.btcUsd != null) fxBits.push(`BTC/USD ${fx.btcUsd.toLocaleString()}`);
        if (fx.btcNzd != null) fxBits.push(`BTC/NZD ${fx.btcNzd.toLocaleString()}`);
      }
      setMinerFxNote(
        fxBits.length
          ? `Live FX · ${fxBits.join(' · ')} (${fx?.source ?? 'quote'})`
          : fx?.message ?? 'FX unavailable — fiat columns stay —',
      );
      setMinerMsg(
        estimate.netBtcStatus === 'ok'
          ? estimate.summary
          : estimate.netBtcMessage ??
              estimate.poolRewardMessage ??
              estimate.summary,
      );
    } catch (err) {
      setMinerMsg((err as Error).message);
    } finally {
      setMinerLoading(false);
    }
  }

  const enabledLabels = useMemo(() => {
    const labels: string[] = [];
    if (showStock) labels.push('stocks');
    if (showCrypto) labels.push('crypto');
    if (showGomining) labels.push('GoMining');
    if (showMetal) labels.push('metals');
    if (showCurrencyExchanger) labels.push('currency exchange');
    if (showStone) labels.push('stones');
    if (showCollectable) labels.push('collectables');
    return labels;
  }, [
    showStock,
    showCrypto,
    showGomining,
    showMetal,
    showCurrencyExchanger,
    showStone,
    showCollectable,
  ]);

  if (!anyTool) {
    return (
      <div className="stack value-search-page">
        <section className="panel">
          <h2 className="page-title">Value search</h2>
          <p className="page-lead">
            No lookup tools are visible — enable asset classes (stocks, crypto, GoMining,
            metals, precious stones, or collectables) or the currency exchanger in{' '}
            <Link to="/settings">Settings</Link>.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="stack value-search-page">
      <section className="panel">
        <h2 className="page-title">Value search</h2>
        <p className="page-lead">
          Preview-only lookups from live quote APIs — never invents prices. Showing tools for
          your enabled classes: <strong>{enabledLabels.join(', ')}</strong>. Change visibility in{' '}
          <Link to="/settings">Settings</Link>.
        </p>
      </section>

      {showStock ? (
        <section className="panel">
          <h2>Stock ticker check</h2>
          <p className="section-desc">
            Live Yahoo Finance price × Frankfurter/BTC FX → NZD per share (same pipeline as
            Portfolio stock charts). Never invents — unavailable when Yahoo or FX fails.
            Akahu-synced holdings still refresh via Akahu.
          </p>
          <form className="form-grid" onSubmit={onStockCheck}>
            <label>
              Ticker
              <input
                value={stockTicker}
                onChange={(e) => setStockTicker(e.target.value)}
                placeholder="e.g. AAPL"
                required
              />
            </label>
            <button type="submit" className="btn primary" disabled={stockLoading}>
              {stockLoading ? 'Checking…' : 'Check stock'}
            </button>
          </form>
          {stockMsg && <p className="banner">{stockMsg}</p>}
          {stockResult && (
            <div className="table-wrap">
            <table className="data-table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th style={{ textAlign: 'right' }}>NZD</th>
                  <th>Status</th>
                  <th>As of (NZT)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{stockResult.ticker}</td>
                  <td>{stockResult.name}</td>
                  <td className="money" style={{ textAlign: 'right' }}>
                    {formatNzd(stockResult.quote.price)}
                  </td>
                  <td>{stockResult.quote.status}</td>
                  <td>{formatAuckland(stockResult.quote.asOf)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </section>
      ) : null}

      {showCrypto ? (
        <section className="panel">
          <h2>Crypto ticker check</h2>
          <p className="section-desc">
            CoinGecko resolve → NZD unit quote when available. Never invents.
          </p>
          <form className="form-grid" onSubmit={onCryptoCheck}>
            <label>
              Ticker
              <input
                value={cryptoTicker}
                onChange={(e) => setCryptoTicker(e.target.value)}
                placeholder="e.g. BTC, GMT"
                required
              />
            </label>
            <button type="submit" className="btn primary" disabled={cryptoLoading}>
              {cryptoLoading ? 'Checking…' : 'Check crypto'}
            </button>
          </form>
          {cryptoMsg && <p className="banner">{cryptoMsg}</p>}
          {cryptoResult && (
            <div className="table-wrap">
            <table className="data-table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th style={{ textAlign: 'right' }}>NZD / unit</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>As of (NZT)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{cryptoResult.ticker}</td>
                  <td>{cryptoResult.name}</td>
                  <td className="money" style={{ textAlign: 'right' }}>
                    {formatNzd(cryptoResult.quote.price)}
                  </td>
                  <td>{cryptoResult.quote.status}</td>
                  <td>{cryptoResult.quote.source}</td>
                  <td>{formatAuckland(cryptoResult.quote.asOf)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </section>
      ) : null}

      {showCollectable ? (
        <>
          <section className="panel">
            <h2>MTG card checker</h2>
            <p className="section-desc">
              Scryfall market USD → Frankfurter NZD. Preview only — does not add a holding.
            </p>
            <form className="form-grid" onSubmit={(e) => onCardCheck(e, 'mtg')}>
              <label>
                Name
                <input
                  value={mtgForm.name}
                  onChange={(e) => setMtgForm({ ...mtgForm, name: e.target.value })}
                  placeholder="e.g. Lightning Bolt"
                />
              </label>
              <label>
                Set code
                <input
                  value={mtgForm.set}
                  onChange={(e) => setMtgForm({ ...mtgForm, set: e.target.value })}
                  placeholder="e.g. lea"
                />
              </label>
              <label>
                Collector #
                <input
                  value={mtgForm.number}
                  onChange={(e) => setMtgForm({ ...mtgForm, number: e.target.value })}
                  placeholder="e.g. 161"
                />
              </label>
              <label>
                Finish
                <select
                  value={mtgForm.finish}
                  onChange={(e) => setMtgForm({ ...mtgForm, finish: e.target.value })}
                >
                  {MTG_FINISHES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Scryfall id (optional)
                <input
                  value={mtgForm.apiId}
                  onChange={(e) => setMtgForm({ ...mtgForm, apiId: e.target.value })}
                  placeholder="e.g. a Scryfall UUID"
                />
              </label>
              <button type="submit" className="btn primary" disabled={mtgLoading}>
                {mtgLoading ? 'Looking up…' : 'Check MTG card'}
              </button>
            </form>
            {mtgMsg && <p className="banner">{mtgMsg}</p>}
            {mtgResult && <CardQuoteTable quote={mtgResult} />}
          </section>

          <section className="panel">
            <h2>Pokémon card checker</h2>
            <p className="section-desc">
              pokemontcg.io TCGPlayer market USD → Frankfurter NZD. Preview only.
            </p>
            <form className="form-grid" onSubmit={(e) => onCardCheck(e, 'pokemon')}>
              <label>
                Name
                <input
                  value={pokeForm.name}
                  onChange={(e) => setPokeForm({ ...pokeForm, name: e.target.value })}
                  placeholder="e.g. Charizard"
                />
              </label>
              <label>
                Set id
                <input
                  value={pokeForm.set}
                  onChange={(e) => setPokeForm({ ...pokeForm, set: e.target.value })}
                  placeholder="e.g. base1"
                />
              </label>
              <label>
                Number
                <input
                  value={pokeForm.number}
                  onChange={(e) => setPokeForm({ ...pokeForm, number: e.target.value })}
                  placeholder="e.g. 4"
                />
              </label>
              <label>
                Finish
                <select
                  value={pokeForm.finish}
                  onChange={(e) => setPokeForm({ ...pokeForm, finish: e.target.value })}
                >
                  {POKEMON_FINISHES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Card id (optional)
                <input
                  value={pokeForm.apiId}
                  onChange={(e) => setPokeForm({ ...pokeForm, apiId: e.target.value })}
                  placeholder="e.g. base1-4"
                />
              </label>
              <button type="submit" className="btn primary" disabled={pokeLoading}>
                {pokeLoading ? 'Looking up…' : 'Check Pokémon card'}
              </button>
            </form>
            {pokeMsg && <p className="banner">{pokeMsg}</p>}
            {pokeResult && <CardQuoteTable quote={pokeResult} />}
          </section>
        </>
      ) : null}

      {showCurrencyExchanger ? (
        <section className="panel">
          <h2>Currency exchange</h2>
          <p className="section-desc">
            Convert any → any using live{' '}
            <a href="https://www.frankfurter.app/docs/" target="_blank" rel="noreferrer">
              Frankfurter
            </a>{' '}
            (ECB) rates for all supported currencies. Search dropdowns by country or currency name
            (e.g. Japan → JPY). USD→NZD falls back to BTC FX ratio when needed. Never invents rates.
          </p>
          <form className="form-grid" onSubmit={onFxConvert}>
            <CurrencyPicker
              label="From"
              value={fxForm.from}
              currencies={fxCurrencies}
              onChange={(code) => setFxForm({ ...fxForm, from: code })}
              disabled={fxLoading}
            />
            <button
              type="button"
              className="btn small fx-swap-btn"
              onClick={swapFxCurrencies}
              disabled={fxLoading}
              title="Swap currencies"
            >
              ⇄ Swap
            </button>
            <CurrencyPicker
              label="To"
              value={fxForm.to}
              currencies={fxCurrencies}
              onChange={(code) => setFxForm({ ...fxForm, to: code })}
              disabled={fxLoading}
            />
            <label>
              Amount (optional)
              <input
                type="number"
                step="any"
                min={0}
                value={fxForm.amount}
                onChange={(e) => setFxForm({ ...fxForm, amount: e.target.value })}
                placeholder="100"
              />
            </label>
            <button type="submit" className="btn primary" disabled={fxLoading || fxCurrencies.length === 0}>
              {fxLoading ? 'Converting…' : `Convert ${fxForm.from} → ${fxForm.to}`}
            </button>
          </form>
          {fxCurrenciesMsg && (
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              Catalogue: {fxCurrencies.length} currencies · {fxCurrenciesMsg}
            </p>
          )}
          {!fxCurrenciesMsg && fxCurrencies.length > 0 && (
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              {fxCurrencies.length} Frankfurter currencies loaded — type a country name to filter.
            </p>
          )}
          {fxMsg && <p className="banner">{fxMsg}</p>}
          {fxResult && (
            <div className="table-wrap">
            <table className="data-table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th style={{ textAlign: 'right' }}>Rate</th>
                  <th style={{ textAlign: 'right' }}>Converted</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>As of (NZT)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{fxResult.fromCurrency}</td>
                  <td>{fxResult.toCurrency}</td>
                  <td className="money" style={{ textAlign: 'right' }}>
                    {fxResult.rate != null ? fxResult.rate.toFixed(6) : '—'}
                  </td>
                  <td className="money" style={{ textAlign: 'right' }}>
                    {fxResult.convertedAmount != null
                      ? formatMoney(fxResult.convertedAmount, fxResult.toCurrency)
                      : fxResult.toCurrency === 'NZD'
                        ? formatNzd(fxResult.nzd)
                        : '—'}
                  </td>
                  <td>{fxResult.status}</td>
                  <td>{fxResult.source}</td>
                  <td>{formatAuckland(fxResult.asOf)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </section>
      ) : null}

      {showGomining ? (
        <section className="panel">
          <h2>GoMining miner output calculator</h2>
          <p className="section-desc">
            Model estimate: Net = PR + GBP − C1 − C2 (sat/TH/day × TH). Uses live GoMining income
            feed + BTC FX from Settings — labelled estimate, not market price. Never invents
            sat/TH or FX.
          </p>
          <form className="form-grid" onSubmit={onMinerCalc}>
            <label>
              Hashrate (TH/s)
              <input
                type="number"
                step="any"
                min={0}
                value={minerForm.hashrateThs}
                onChange={(e) => setMinerForm({ ...minerForm, hashrateThs: e.target.value })}
                required
              />
            </label>
            <label>
              Energy efficiency (W/TH)
              <input
                type="number"
                step="any"
                min={0}
                value={minerForm.energyEfficiencyWth}
                onChange={(e) =>
                  setMinerForm({ ...minerForm, energyEfficiencyWth: e.target.value })
                }
                placeholder="20"
              />
            </label>
            <label>
              Discount % (C1+C2)
              <input
                type="number"
                step="any"
                min={0}
                max={100}
                value={minerForm.discountPct}
                onChange={(e) => setMinerForm({ ...minerForm, discountPct: e.target.value })}
              />
            </label>
            <label>
              Display
              <select
                value={minerDisplay}
                onChange={(e) =>
                  setMinerDisplay(e.target.value as EarningsDisplayCurrency)
                }
              >
                <option value="NZD">NZD</option>
                <option value="USD">USD</option>
                <option value="BTC">BTC</option>
                <option value="ALL">All</option>
              </select>
            </label>
            <button type="submit" className="btn primary" disabled={minerLoading}>
              {minerLoading ? 'Calculating…' : 'Calculate output'}
            </button>
          </form>
          {minerMsg && <p className="banner">{minerMsg}</p>}
          {minerFxNote && (
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              {minerFxNote}
            </p>
          )}
          {minerEstimate && (
            <>
              <div className="table-wrap">
              <table className="data-table" style={{ marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th style={{ textAlign: 'right' }}>Net</th>
                    <th style={{ textAlign: 'right' }}>Pool</th>
                    <th style={{ textAlign: 'right' }}>Maint. USD</th>
                  </tr>
                </thead>
                <tbody>
                  {(['day', 'week', 'month', 'year'] as const).map((period) => {
                    const slice = minerEstimate.periods[period];
                    return (
                      <tr key={period}>
                        <td style={{ textTransform: 'capitalize' }}>{period}</td>
                        <td className="money" style={{ textAlign: 'right' }}>
                          {minerDisplay === 'ALL'
                            ? [
                                formatEarningsAmount(slice, 'BTC', true),
                                formatEarningsAmount(slice, 'USD', true),
                                formatEarningsAmount(slice, 'NZD', true),
                              ].join(' · ')
                            : formatEarningsAmount(slice, minerDisplay, true)}
                        </td>
                        <td className="money" style={{ textAlign: 'right' }}>
                          {minerDisplay === 'ALL'
                            ? [
                                formatEarningsAmount(slice, 'BTC', false),
                                formatEarningsAmount(slice, 'USD', false),
                                formatEarningsAmount(slice, 'NZD', false),
                              ].join(' · ')
                            : formatEarningsAmount(slice, minerDisplay, false)}
                        </td>
                        <td className="money" style={{ textAlign: 'right' }}>
                          {slice.maintenanceUsd == null
                            ? '—'
                            : `$${slice.maintenanceUsd.toFixed(4)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <p className="muted small" style={{ marginTop: '0.75rem' }}>
                Per TH: PR{' '}
                {minerEstimate.poolRewardSatPerTh != null
                  ? `${minerEstimate.poolRewardSatPerTh.toFixed(4)} sat`
                  : '—'}{' '}
                · GBP {minerEstimate.goBtcPaySatPerTh.toFixed(4)} sat · C1{' '}
                {minerEstimate.electricitySatPerThAfterDiscount != null
                  ? `${minerEstimate.electricitySatPerThAfterDiscount.toFixed(4)} sat`
                  : '—'}{' '}
                · C2{' '}
                {minerEstimate.serviceSatPerThAfterDiscount != null
                  ? `${minerEstimate.serviceSatPerThAfterDiscount.toFixed(4)} sat`
                  : '—'}{' '}
                · net{' '}
                {minerEstimate.netSatPerTh != null
                  ? `${minerEstimate.netSatPerTh.toFixed(4)} sat/TH`
                  : '—'}
                {minerEstimate.netBtcPerDay != null
                  ? ` · ${formatBtc(minerEstimate.netBtcPerDay)} BTC/day`
                  : ''}
              </p>
            </>
          )}
        </section>
      ) : null}

      {showMetal ? (
        <section className="panel">
          <h2>Metal spot values</h2>
          <p className="section-desc">
            Live precious-metal spots in NZD per troy ounce via{' '}
            <a href="https://api.gold-api.com/price/XAU/NZD" target="_blank" rel="noreferrer">
              gold-api.com
            </a>
            . Display as oz t or grams. Metals.Dev is used only when its key is set.
          </p>
          <div className="row gap" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn primary"
              disabled={loading}
              onClick={() => loadMetals(true)}
            >
              {loading ? 'Refreshing…' : 'Refresh metal quotes'}
            </button>
            <div className="row gap" style={{ alignItems: 'center' }} role="group" aria-label="Metal price unit">
              <button
                type="button"
                className={metalUnit === 'oz_t' ? 'btn primary' : 'btn'}
                disabled={loading}
                onClick={() => {
                  setMetalUnit('oz_t');
                  saveMetalDisplayUnit('oz_t');
                }}
              >
                NZD / oz t
              </button>
              <button
                type="button"
                className={metalUnit === 'g' ? 'btn primary' : 'btn'}
                disabled={loading}
                onClick={() => {
                  setMetalUnit('g');
                  saveMetalDisplayUnit('g');
                }}
              >
                NZD / g
              </button>
            </div>
            <span className="muted small">
              {configured == null
                ? 'Checking…'
                : configured
                  ? quotaBlocked
                    ? 'METALS_API_KEY set · Metals.Dev quota blocked (using last-good if any)'
                    : 'METALS_API_KEY set · Metals.Dev'
                  : 'Live NZD spots via gold-api.com (no key)'}
            </span>
          </div>
          {msg && <p className="banner">{msg}</p>}
          {quotaMessage && !msg ? <p className="banner">{quotaMessage}</p> : null}

          <div className="table-wrap">
          <table className="data-table" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Metal</th>
                <th style={{ textAlign: 'right' }}>{metalUnitLabel(metalUnit)}</th>
                <th>Status</th>
                <th>As of (NZT)</th>
              </tr>
            </thead>
            <tbody>
              {(quotes.length
                ? quotes
                : ['gold', 'silver', 'platinum', 'palladium'].map((metal) => ({
                    metal,
                    assetKey: `METAL:${metal}:oz_t`,
                    currency: 'NZD',
                    price: null,
                    status: 'unavailable',
                    source: 'stub',
                    asOf: null,
                    message: null,
                  }))
              ).map((q) => (
                <tr key={q.metal}>
                  <td style={{ textTransform: 'capitalize' }}>{q.metal}</td>
                  <td className="money" style={{ textAlign: 'right' }}>
                    {formatNzd(nzdPerOzToDisplay(q.price, metalUnit))}
                  </td>
                  <td>{q.status}</td>
                  <td>{formatAuckland(q.asOf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            Stored as NZD/oz t (grams = ÷ 31.1034768). Default source is gold-api.com NZD.
            Metals.Dev is used only when its key is set; a quota miss keeps the last good price
            (never invent).
          </p>
        </section>
      ) : null}

      {showStone ? (
        <section className="panel">
          <h2>Diamond values (OpenFacet)</h2>
          <p className="section-desc">
            Preview only — does not create a holding. USD from{' '}
            <a href="https://openfacet.net/" target="_blank" rel="noreferrer">
              OpenFacet
            </a>
            , converted with Frankfurter to NZD. Carat 0.3–6.0 · colour D–M · clarity FL–SI2.
          </p>
          <form className="form-grid" onSubmit={onDiamondQuote}>
            <label>
              Carat
              <input
                type="number"
                step="any"
                min={0.3}
                max={6}
                value={diamondForm.carat}
                onChange={(e) => setDiamondForm({ ...diamondForm, carat: e.target.value })}
                required
              />
            </label>
            <label>
              Colour
              <select
                value={diamondForm.colour}
                onChange={(e) => setDiamondForm({ ...diamondForm, colour: e.target.value })}
              >
                {DIAMOND_COLOURS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Clarity
              <select
                value={diamondForm.clarity}
                onChange={(e) => setDiamondForm({ ...diamondForm, clarity: e.target.value })}
              >
                {DIAMOND_CLARITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Shape
              <select
                value={diamondForm.shape}
                onChange={(e) => setDiamondForm({ ...diamondForm, shape: e.target.value })}
              >
                {DIAMOND_SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn primary" disabled={diamondLoading}>
              {diamondLoading ? 'Quoting…' : 'Get diamond NZD'}
            </button>
          </form>
          {diamondMsg && <p className="banner">{diamondMsg}</p>}
          {diamondQuote && (
            <div className="table-wrap">
            <table className="data-table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th>NZD total</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>As of (NZT)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="money">{formatNzd(diamondQuote.price)}</td>
                  <td>{diamondQuote.status}</td>
                  <td>{diamondQuote.source}</td>
                  <td>{formatAuckland(diamondQuote.asOf)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
          {diamondQuote?.message && (
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              {diamondQuote.message}
            </p>
          )}
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            Non-diamond gems (ruby, sapphire, emerald, …) have no live API here — add on Portfolio
            with a manual estimated NZD only.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function CardQuoteTable({ quote }: { quote: CardResult }) {
  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Card</th>
            <th>Set / #</th>
            <th>Finish</th>
            <th style={{ textAlign: 'right' }}>USD</th>
            <th style={{ textAlign: 'right' }}>NZD</th>
            <th>Status</th>
            <th>As of (NZT)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                {quote.imageUrl ? (
                  <img
                    src={quote.imageUrl}
                    alt=""
                    width={40}
                    height={56}
                    style={{ borderRadius: 4, objectFit: 'cover' }}
                  />
                ) : null}
                <span>
                  {quote.name || '—'}
                  {quote.rarity ? (
                    <span className="muted small"> · {quote.rarity}</span>
                  ) : null}
                </span>
              </div>
            </td>
            <td>
              {(quote.set ?? '—') + (quote.number ? ` #${quote.number}` : '')}
            </td>
            <td>{quote.finish ?? '—'}</td>
            <td className="money" style={{ textAlign: 'right' }}>
              {quote.unitUsd != null ? `$${quote.unitUsd.toFixed(2)}` : '—'}
            </td>
            <td className="money" style={{ textAlign: 'right' }}>
              {formatNzd(quote.unitNzd)}
            </td>
            <td>{quote.status}</td>
            <td>{formatAuckland(quote.asOf)}</td>
          </tr>
        </tbody>
      </table>
      </div>
      {quote.message && (
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          {quote.message}
        </p>
      )}
    </div>
  );
}
