/**
 * Add a read-only crypto wallet by public address (KAN-45).
 * Used in Portfolio → Crypto and in sign-up when Crypto is enabled.
 * Never asks for a private key, recovery phrase or password; obvious secrets are
 * blocked here before they leave the browser, and the server rejects the rest.
 */
import { useId, useState, type FormEvent } from 'react';
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
