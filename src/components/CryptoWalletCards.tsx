/**
 * Crypto wallets as cards in Portfolio → Crypto (KAN-44), alongside the holding cards.
 * Each card is titled by its short address and shows holdings, NZD value, last synced
 * and status, with Sync now / Remove. Values come from GET /api/wallets/valuation,
 * which reads balances fetched by the sync job.
 */
import { formatNzd } from '../api/client';
import {
  NATIVE_SYMBOL,
  NETWORK_LABEL,
  formatWalletAmount as formatAmount,
  isEmptyWallet,
  relativeTime,
  shortAddress,
  type CryptoWalletsState,
  type WalletEntry as Entry,
} from '../lib/cryptoWallets';
import { HoldingIcon } from './HoldingIcon';
import { AddWalletPanel } from './AddWalletPanel';

export function WalletCard({ entry, state }: { entry: Entry; state: CryptoWalletsState }) {
  const { wallet, valuation } = entry;
  const symbol = NATIVE_SYMBOL[wallet.network];
  const val = valuation?.ok ? valuation : null;
  const items = val?.items.filter((i) => i.amountRaw !== '0' || i.asset.kind === 'native') ?? [];
  const native = items.find((i) => i.asset.kind === 'native');
  const tokens = items.filter((i) => i.asset.kind === 'token');
  const syncing = wallet.status === 'syncing' || (state.busy?.id === wallet.id && state.busy.action === 'sync');
  const removing = state.busy?.id === wallet.id && state.busy.action === 'remove';
  const warnEmpty = isEmptyWallet(entry) && !state.keptEmpty.includes(wallet.id);

  return (
    <article className="holding-card wallet-card" aria-label={`${wallet.name} wallet ${wallet.address}`}>
      <header className="holding-card-head">
        <HoldingIcon ticker={symbol} assetClass="crypto" />
        <div className="holding-card-titles">
          <h4 className="holding-card-name wallet-card-address" title={wallet.address}>
            {shortAddress(wallet.address)}
          </h4>
          <span className="holding-card-ticker muted small">
            {wallet.name} · {NETWORK_LABEL[wallet.network]}
          </span>
        </div>
      </header>

      <div className="holding-card-amount">
        {native ? `${formatAmount(native.amount)} ${native.asset.symbol}` : val ? `0 ${symbol}` : '—'}
      </div>

      <dl className="holding-card-stats">
        <div>
          <dt>Value</dt>
          <dd>{val ? formatNzd(val.totalNzd) : '—'}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{native?.priceNzd != null ? formatNzd(native.priceNzd) : '—'}</dd>
        </div>
        <div>
          <dt>Last synced</dt>
          <dd title={wallet.lastSynced ?? undefined}>{wallet.lastSynced ? relativeTime(wallet.lastSynced) : 'Never'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd className={`wallet-status wallet-status--${syncing ? 'syncing' : wallet.status === 'error' ? 'error' : 'ok'}`}>
            {syncing ? 'Syncing…' : wallet.status === 'error' ? 'Error' : 'Connected'}
          </dd>
        </div>
      </dl>

      {tokens.length > 0 ? (
        <ul className="wallet-card-tokens">
          {tokens.map((t) => (
            <li key={t.asset.contract ?? t.asset.symbol}>
              <span>
                {formatAmount(t.amount)} {t.asset.symbol}
              </span>
              <span className="muted">{t.valueNzd != null ? formatNzd(t.valueNzd) : 'not priced'}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {wallet.status === 'error' && wallet.statusMessage ? (
        <p className="muted small holding-card-meta wallet-status--error">{wallet.statusMessage}</p>
      ) : null}
      {warnEmpty ? (
        <div className="wallet-empty-warning" role="note">
          <p>
            This address holds nothing right now. If it&apos;s a deposit address from Nexo, GoMining or an
            exchange, it won&apos;t show your balance there — add that as a manual crypto holding instead.
          </p>
          <div className="row gap">
            <button type="button" className="btn ghost" onClick={() => state.keepEmpty(wallet)}>
              Keep wallet
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => void state.remove(wallet)}
              disabled={removing}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
      {val?.hasStalePrices && val.pricedAt ? (
        <p className="muted small holding-card-meta">Price from {relativeTime(val.pricedAt)} (live price unavailable).</p>
      ) : null}
      {val && !val.complete ? (
        <p className="muted small holding-card-meta">Some holdings aren&apos;t priced yet and are left out of the value.</p>
      ) : null}
      {valuation && !valuation.ok && wallet.status !== 'error' ? (
        <p className="muted small holding-card-meta">{valuation.error}</p>
      ) : null}

      <div className="holding-card-actions">
        <button
          type="button"
          className="btn ghost holding-card-action"
          onClick={() => void state.syncNow(wallet)}
          disabled={syncing || removing}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          type="button"
          className="btn danger holding-card-action"
          onClick={() => void state.remove(wallet)}
          disabled={removing}
          aria-label={`Remove wallet ${wallet.name}`}
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </article>
  );
}

/** "Wallets total" for the Crypto section header — sums wallet values only. */
export function WalletsTotal({ state }: { state: CryptoWalletsState }) {
  const { data, entries } = state;
  if (entries.length === 0) return null;
  const count = entries.length;
  return (
    <div className="wallets-total" role="status">
      <span className="wallets-total-label">
        Wallets total ({count} wallet{count === 1 ? '' : 's'})
      </span>
      <strong className="wallets-total-value">{data ? formatNzd(data.totalNzd) : '—'}</strong>
      {data && !data.complete ? (
        <span className="muted small">
          {data.failedWallets > 0
            ? `${data.failedWallets} wallet${data.failedWallets === 1 ? '' : 's'} not valued`
            : 'some holdings not priced'}
        </span>
      ) : data?.pricedAt ? (
        <span className="muted small">priced {relativeTime(data.pricedAt)}</span>
      ) : null}
    </div>
  );
}

export function WalletNotices({ state }: { state: CryptoWalletsState }) {
  return (
    <>
      {state.error ? <p className="warn">{state.error}</p> : null}
      {state.notice ? (
        <p className="muted small" role="status">
          {state.notice}
        </p>
      ) : null}
    </>
  );
}

export function AddWalletDetails({ state, onUseManual }: { state: CryptoWalletsState; onUseManual: () => void }) {
  return (
    <details className="section-add">
      <summary className="section-add-summary">
        <span className="section-add-label">Add wallet</span>
      </summary>
      <AddWalletPanel onAdded={state.added} onUseManual={onUseManual} />
    </details>
  );
}
