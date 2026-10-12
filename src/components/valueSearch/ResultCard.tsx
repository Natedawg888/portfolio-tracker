import { Link } from 'react-router-dom';
import { formatAuckland, formatMoney, formatNzd } from '../../api/client';
import { CARD_FINISHES } from '../../lib/collectables';
import type { Holding } from '../../lib/holdingDisplay';
import type { MetalDisplayUnit } from '../../lib/metalUnits';
import type { LookupState } from '../../lib/useDebouncedLookup';
import { SEARCH_TYPE_LABEL, SOURCE_NAME, type ParsedQuery } from '../../lib/valueSearchDetect';
import type { CardRefine, LookupResult } from '../../lib/valueSearchLookup';
import { addAction, findOwned, metalHeadline } from '../../lib/valueSearchView';
import { CurrencyPicker, type CurrencyOption } from '../CurrencyPicker';
import { InfoTip } from '../InfoTip';

export type MinerFields = { wPerTh: string; discountPct: string; wPerThHint: string };

/** Inputs inside the card that refine the lookup; each change re-runs it through the debounced hook. */
export type ResultControls = {
  metalUnit: MetalDisplayUnit;
  onMetalUnitChange: (unit: MetalDisplayUnit) => void;
  card: CardRefine;
  onCardChange: (next: CardRefine) => void;
  miner: MinerFields;
  onMinerChange: (field: 'wPerTh' | 'discountPct', value: string) => void;
  /** Frankfurter catalogue; null while loading or when it failed. */
  currencies: CurrencyOption[] | null;
  /** Codes in the query that are not in the catalogue; no fx request is made for them. */
  unknownCurrencies: ('from' | 'to')[];
  onCurrencyChange: (next: { from: string; to: string }) => void;
};

function money(value: number | null, currency: string): string {
  return currency === 'NZD' ? formatNzd(value) : formatMoney(value, currency);
}

function SourceLine({ result }: { result: LookupResult }) {
  const asOf = result.asOf ? ` · as of ${formatAuckland(result.asOf)}` : '';
  switch (result.status.kind) {
    case 'live':
      return <p className="muted small vs-result-source">{result.source}{asOf}</p>;
    case 'stale':
      return <p className="small vs-result-source vs-status-stale">Stale · {result.source}{asOf}</p>;
    case 'estimate':
      // The "Model estimate" label sits above the figures.
      return <p className="muted small vs-result-source">{result.source}{asOf}</p>;
    case 'unavailable':
      return (
        <p className="small vs-result-source vs-status-unavailable">
          Unavailable from {result.source}
          {result.status.message ? ` · ${result.status.message}` : ''}
        </p>
      );
  }
}

/**
 * One card for every type. The value part is a polite live region so each new result is
 * announced; the refine controls sit outside it and stay mounted while a lookup runs, so
 * typing in them never loses focus.
 */
export function ResultCard({
  parsed,
  state,
  hint,
  holdings,
  forexEnabled,
  controls,
}: {
  parsed: ParsedQuery | null;
  state: LookupState<LookupResult>;
  /** Shown when the chosen type can't read the query (e.g. Metal + "Charizard"). */
  hint: string | null;
  holdings: readonly Holding[];
  forexEnabled: boolean;
  controls: ResultControls;
}) {
  const loading = state.status === 'loading';
  const result = state.status === 'done' ? state.result : null;
  const blockedCurrency = parsed?.type === 'currency' && controls.unknownCurrencies.length > 0;
  return (
    <section className="vs-result-region">
      {hint ? <p className="muted vs-hint" aria-live="polite">{hint}</p> : null}
      {!hint && parsed ? (
        <article className="panel vs-result">
          <div className="vs-result-live" aria-live="polite" aria-busy={loading}>
            <p className="vs-result-type">{SEARCH_TYPE_LABEL[parsed.type]}</p>
            {blockedCurrency ? (
              <CurrencyProblem parsed={parsed} unknown={controls.unknownCurrencies} />
            ) : loading ? (
              <p className="muted">Looking up…</p>
            ) : state.status === 'error' ? (
              <>
                <p className="vs-result-value vs-result-value-unavailable">Unavailable</p>
                <p className="small vs-result-source vs-status-unavailable">
                  Unavailable from {SOURCE_NAME[parsed.type]} · {state.message}
                </p>
              </>
            ) : result ? (
              <ResultBody result={result} holdings={holdings} forexEnabled={forexEnabled} metalUnit={controls.metalUnit} />
            ) : null}
          </div>
          <Refine parsed={parsed} controls={controls} />
        </article>
      ) : null}
    </section>
  );
}

function CurrencyProblem({ parsed, unknown }: { parsed: Extract<ParsedQuery, { type: 'currency' }>; unknown: ('from' | 'to')[] }) {
  const codes = unknown.map((side) => parsed[side]).join(' and ');
  return (
    <>
      <h3 className="vs-result-title">
        {parsed.from} → {parsed.to}
      </h3>
      <p className="vs-status-unavailable">
        {codes} {unknown.length === 1 ? 'is not a currency' : 'are not currencies'} Frankfurter quotes. Choose one below.
      </p>
    </>
  );
}

function ResultBody({
  result,
  holdings,
  forexEnabled,
  metalUnit,
}: {
  result: LookupResult;
  holdings: readonly Holding[];
  forexEnabled: boolean;
  metalUnit: MetalDisplayUnit;
}) {
  const unavailable = result.status.kind === 'unavailable';
  const headline =
    result.type === 'metal'
      ? metalHeadline(result.perOzNzd, result.amount, result.amountUnit, metalUnit)
      : { value: result.value, note: result.note, perUnit: null };
  const owned = findOwned(result, holdings);
  const add = owned ? null : addAction(result, { forexEnabled });
  return (
    <>
      <h3 className="vs-result-title">{result.title}</h3>
      {result.detail ? <p className="muted small vs-result-detail">{result.detail}</p> : null}
      <p className={'vs-result-value' + (unavailable ? ' vs-result-value-unavailable' : '')}>
        {unavailable ? 'Unavailable' : money(headline.value, result.currency)}
      </p>
      {!unavailable && headline.note ? (
        <p className="muted vs-result-note">
          {headline.note}
          {result.type === 'metal' && result.amount != null
            ? ` · ${formatNzd(headline.perUnit)} ${metalUnit === 'g' ? 'per gram' : 'per oz t'}`
            : ''}
        </p>
      ) : null}
      {result.type === 'miner' && !unavailable ? <MinerPeriods result={result} /> : null}
      {owned ? (
        <p className="vs-owned">
          <Link to={owned.href}>
            {owned.text}
            {owned.worthNzd != null ? `, worth ${formatNzd(owned.worthNzd)}` : ''}
          </Link>
        </p>
      ) : null}
      {add ? (
        <p className="vs-add">
          <Link className="btn small" to={add.href}>
            {add.label}
          </Link>
        </p>
      ) : null}
      <SourceLine result={result} />
    </>
  );
}

function MinerPeriods({ result }: { result: Extract<LookupResult, { type: 'miner' }> }) {
  return (
    <div className="vs-miner">
      <p className="small vs-miner-label">
        Model estimate
        <InfoTip label="What the miner estimate uses">
          Net earnings after electricity and service fees, from live inputs:{' '}
          {result.liveInputs.map((i, n) => (
            <span key={i.label}>
              {n > 0 ? '; ' : ''}
              {i.label} {i.ok ? 'live' : 'unavailable'}
              {i.detail ? ` (${i.detail})` : ''}
            </span>
          ))}
          . W/TH {result.wPerTh}, discount {result.discountPct}%.
        </InfoTip>
      </p>
      <dl className="vs-result-rows">
        {(['day', 'month', 'year'] as const).map((p) => (
          <div key={p}>
            <dt>{p === 'day' ? 'Day' : p === 'month' ? 'Month' : 'Year'}</dt>
            <dd className="money">{formatNzd(result.periods[p].nzd)}</dd>
            <dd className="muted small">
              {result.periods[p].btc != null ? `${result.periods[p].btc.toFixed(8)} BTC` : '—'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Refine({ parsed, controls }: { parsed: ParsedQuery; controls: ResultControls }) {
  switch (parsed.type) {
    case 'metal':
      return (
        <div className="vs-refine">
          <div className="segmented segmented--small" role="group" aria-label="Metal price unit">
            {(['oz_t', 'g'] as const).map((u) => (
              <button
                key={u}
                type="button"
                className={'segmented-btn' + (controls.metalUnit === u ? ' active' : '')}
                aria-pressed={controls.metalUnit === u}
                onClick={() => controls.onMetalUnitChange(u)}
              >
                {u === 'oz_t' ? 'oz t' : 'gram'}
              </button>
            ))}
          </div>
        </div>
      );
    case 'mtg':
    case 'pokemon': {
      const byId = 'apiId' in parsed;
      const set = (patch: Partial<CardRefine>) => controls.onCardChange({ ...controls.card, ...patch });
      return (
        <div className="vs-refine form-grid">
          {byId ? (
            <p className="muted small span-2">Card id {parsed.apiId} picks one printing.</p>
          ) : (
            <>
              <label>
                Set (optional)
                <input
                  value={controls.card.set}
                  onChange={(e) => set({ set: e.target.value })}
                  placeholder={parsed.type === 'mtg' ? 'e.g. lea' : 'e.g. base1'}
                  autoComplete="off"
                />
              </label>
              <label>
                Number (optional)
                <input
                  value={controls.card.number}
                  onChange={(e) => set({ number: e.target.value })}
                  placeholder="e.g. 161"
                  autoComplete="off"
                />
              </label>
            </>
          )}
          <label>
            Finish
            <select value={controls.card.finish} onChange={(e) => set({ finish: e.target.value })}>
              <option value="">Any</option>
              {CARD_FINISHES[parsed.type].map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      );
    }
    case 'currency': {
      const { from, to } = parsed;
      const catalogue = controls.currencies;
      return (
        <div className="vs-refine vs-refine-currency">
          <button
            type="button"
            className="btn small"
            aria-label="Swap currencies"
            onClick={() => controls.onCurrencyChange({ from: to, to: from })}
          >
            ⇄
          </button>
          {catalogue
            ? controls.unknownCurrencies.map((side) => (
                <CurrencyPicker
                  key={side}
                  label={side === 'from' ? 'From' : 'To'}
                  value={parsed[side]}
                  currencies={catalogue}
                  onChange={(code) => controls.onCurrencyChange({ from, to, [side]: code })}
                />
              ))
            : null}
        </div>
      );
    }
    case 'miner':
      return (
        <div className="vs-refine form-grid">
          <label>
            Efficiency (W/TH)
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={controls.miner.wPerTh}
              onChange={(e) => controls.onMinerChange('wPerTh', e.target.value)}
            />
            <span className="muted small">{controls.miner.wPerThHint}</span>
          </label>
          <label>
            Discount (%)
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              value={controls.miner.discountPct}
              placeholder="From Settings"
              onChange={(e) => controls.onMinerChange('discountPct', e.target.value)}
            />
            <span className="muted small">Starts at your Settings discount</span>
          </label>
        </div>
      );
    default:
      return null;
  }
}
