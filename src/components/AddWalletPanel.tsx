/**
 * Add a read-only crypto wallet by public address (KAN-45).
 * Used in Portfolio → Crypto and in sign-up when Crypto is enabled.
 * Never asks for a private key, recovery phrase or password; obvious secrets are
 * blocked here before they leave the browser, and the server rejects the rest.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { Wallet, WalletNetwork } from '../types';

export const WALLET_SECURITY_COPY =
  'KoruLedger uses your public wallet address to read your blockchain holdings. 🔒 Read-only. We will never ask for or store your private key or recovery phrase. You can remove the wallet at any time.';

type Choice = 'ethereum' | 'bitcoin' | 'solana' | 'other';

const PRIMARY: Array<{ value: Choice; label: string }> = [
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'bitcoin', label: 'Bitcoin' },
  { value: 'solana', label: 'Solana' },
  { value: 'other', label: 'Other networks' },
];

const OTHER: Array<{ value: WalletNetwork; label: string }> = [
  { value: 'polygon', label: 'Polygon' },
  { value: 'base', label: 'Base' },
  { value: 'arbitrum', label: 'Arbitrum' },
];

const PLACEHOLDER: Record<WalletNetwork, string> = {
  ethereum: '0x…',
  polygon: '0x…',
  base: '0x…',
  arbitrum: '0x…',
  bitcoin: 'bc1…, 1… or 3…',
  solana: 'Solana address',
};

const SEED_MSG =
  'That looks like a recovery phrase. Never share it with anyone — only your public wallet address is needed.';
const KEY_MSG =
  'That looks like a private key. Never share it with anyone — only your public wallet address is needed.';

/** Catch the obvious cases client-side so they are never sent anywhere. */
function obviousSecret(input: string): string | null {
  const s = input.trim();
  if (s.split(/[\s,;]+/).filter((w) => /^\p{L}{3,8}$/u.test(w)).length >= 12) return SEED_MSG;
  if (/^(0x)?[0-9a-f]{64}$/i.test(s)) return KEY_MSG;
  if (/^[xyztuvYZUV]prv/.test(s)) return KEY_MSG;
  return null;
}

type Props = {
  onAdded: (wallet: Wallet) => void;
  /** Sign-up: show a skip button. */
  onSkip?: () => void;
  skipLabel?: string;
};

export function AddWalletPanel({ onAdded, onSkip, skipLabel = 'Skip for now' }: Props) {
  const ids = useId();
  const [choice, setChoice] = useState<Choice>('ethereum');
  const [otherNetwork, setOtherNetwork] = useState<WalletNetwork>('polygon');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const network: WalletNetwork = choice === 'other' ? otherNetwork : choice;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setAdded(null);
    const secret = obviousSecret(address);
    if (secret) {
      setAddress(''); // don't leave a secret sitting in the field
      setError(secret);
      return;
    }
    setBusy(true);
    try {
      const wallet = await api.wallets.create({
        network,
        address: address.trim(),
        name: name.trim() || undefined,
      });
      setAddress('');
      setName('');
      setAdded(`${wallet.name} added.`);
      onAdded(wallet);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SECRET_REJECTED') setAddress('');
      setError(err instanceof ApiError ? err.message : 'Could not add the wallet. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="add-wallet" onSubmit={onSubmit} autoComplete="off">
      <div className="wallet-security" role="note" aria-label="Read-only wallet">
        <p>{WALLET_SECURITY_COPY}</p>
      </div>

      <fieldset className="wallet-networks" disabled={busy}>
        <legend>Network</legend>
        <div className="wallet-network-row" role="radiogroup" aria-label="Network">
          {PRIMARY.map((n) => (
            <button
              key={n.value}
              type="button"
              role="radio"
              aria-checked={choice === n.value}
              className={choice === n.value ? 'wallet-network-btn active' : 'wallet-network-btn'}
              onClick={() => setChoice(n.value)}
            >
              {n.label}
            </button>
          ))}
        </div>
        {choice === 'other' && (
          <div className="wallet-network-row wallet-network-row--sub" role="radiogroup" aria-label="Other network">
            {OTHER.map((n) => (
              <button
                key={n.value}
                type="button"
                role="radio"
                aria-checked={otherNetwork === n.value}
                className={otherNetwork === n.value ? 'wallet-network-btn active' : 'wallet-network-btn'}
                onClick={() => setOtherNetwork(n.value)}
              >
                {n.label}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <label className="field" htmlFor={`${ids}-address`}>
        <span>Public wallet address</span>
        <input
          id={`${ids}-address`}
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={PLACEHOLDER[network]}
          required
          disabled={busy}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
          maxLength={120}
        />
      </label>
      <label className="field" htmlFor={`${ids}-name`}>
        <span>Name (optional)</span>
        <input
          id={`${ids}-name`}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ledger, MetaMask"
          maxLength={80}
          disabled={busy}
          autoComplete="off"
        />
      </label>

      {error ? (
        <p className="auth-error warn" role="alert">
          {error}
        </p>
      ) : null}
      {added ? (
        <p className="muted" role="status">
          {added}
        </p>
      ) : null}

      <div className="row gap">
        <button type="submit" className="btn primary" disabled={busy || !address.trim()}>
          {busy ? 'Adding…' : 'Add wallet'}
        </button>
        {onSkip ? (
          <button type="button" className="btn ghost" onClick={onSkip} disabled={busy}>
            {skipLabel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

const NETWORK_LABEL: Record<WalletNetwork, string> = {
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  base: 'Base',
  arbitrum: 'Arbitrum',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
};

function relativeTime(iso: string, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return new Date(iso).toLocaleDateString('en-NZ');
}

function WalletStatus({ wallet }: { wallet: Wallet }) {
  if (wallet.status === 'syncing') {
    return <span className="wallet-status wallet-status--syncing">Syncing…</span>;
  }
  if (wallet.status === 'error') {
    return (
      <span className="wallet-status wallet-status--error" title={wallet.statusMessage ?? undefined}>
        Error{wallet.statusMessage ? `: ${wallet.statusMessage}` : ''}
      </span>
    );
  }
  return (
    <span className="wallet-status wallet-status--ok">
      {wallet.lastSynced ? `Connected · synced ${relativeTime(wallet.lastSynced)}` : 'Connected · not synced yet'}
    </span>
  );
}

/** A freshly added / syncing wallet is worth re-checking shortly. */
const needsRefresh = (w: Wallet) => w.status === 'syncing' || (w.status === 'connected' && !w.lastSynced);

/** Portfolio → Crypto: connected wallets + Add wallet. */
export function CryptoWallets() {
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.wallets
      .list()
      .then((rows) => {
        if (!cancelled) setWallets(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load wallets');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Background sync runs server-side after adding a wallet; poll briefly until it settles.
  const pending = (wallets ?? []).some(needsRefresh);
  useEffect(() => {
    if (!pending) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      api.wallets
        .list()
        .then(setWallets)
        .catch(() => {});
      if (tries >= 12) window.clearInterval(timer);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pending]);

  const replace = (w: Wallet) => setWallets((rows) => (rows ?? []).map((r) => (r.id === w.id ? w : r)));

  const syncNow = async (w: Wallet) => {
    setSyncing(w.id);
    setError(null);
    setNotice(null);
    replace({ ...w, status: 'syncing' });
    try {
      const r = await api.wallets.sync(w.id);
      replace(r.wallet);
      if (!r.synced && r.error) setNotice(r.error);
    } catch (err) {
      replace(w);
      if (err instanceof ApiError && err.status === 429) {
        try {
          const body = JSON.parse(err.body) as { wallet?: Wallet };
          if (body.wallet) replace(body.wallet);
        } catch {
          /* keep previous row */
        }
        setNotice(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not sync wallet');
      }
    } finally {
      setSyncing(null);
    }
  };

  const remove = async (w: Wallet) => {
    if (!window.confirm(`Remove “${w.name}”? Only the saved address is deleted — nothing on-chain changes.`)) return;
    setRemoving(w.id);
    setError(null);
    try {
      await api.wallets.remove(w.id);
      setWallets((rows) => (rows ?? []).filter((r) => r.id !== w.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove wallet');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="crypto-wallets">
      <h4>Wallets</h4>
      {error ? <p className="warn">{error}</p> : null}
      {notice ? (
        <p className="muted small" role="status">
          {notice}
        </p>
      ) : null}
      {wallets === null && !error ? <p className="muted small">Loading wallets…</p> : null}
      {wallets && wallets.length === 0 ? (
        <p className="muted small">No wallets connected. Add a public address to track on-chain holdings.</p>
      ) : null}
      {wallets && wallets.length > 0 ? (
        <ul className="wallet-list">
          {wallets.map((w) => (
            <li key={w.id}>
              <div className="wallet-main">
                <strong>{w.name}</strong> <span className="muted small">· {NETWORK_LABEL[w.network]}</span>
                <span className="wallet-address" title={w.address}>
                  {w.address}
                </span>
                <WalletStatus wallet={w} />
              </div>
              <div className="wallet-actions">
                <button
                  type="button"
                  className="btn small"
                  onClick={() => void syncNow(w)}
                  disabled={syncing === w.id || w.status === 'syncing'}
                >
                  {syncing === w.id || w.status === 'syncing' ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() => void remove(w)}
                  disabled={removing === w.id}
                >
                  {removing === w.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="section-add" open={adding} onToggle={(e) => setAdding((e.target as HTMLDetailsElement).open)}>
        <summary className="section-add-summary">
          <span className="section-add-label">Add wallet</span>
        </summary>
        <AddWalletPanel onAdded={(w) => setWallets((rows) => [...(rows ?? []), w])} />
      </details>
    </div>
  );
}
