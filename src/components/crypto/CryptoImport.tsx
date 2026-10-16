/**
 * Import on-chain transfers from a synced wallet into the crypto ledger (KAN-47). Each transfer
 * comes with a suggested kind and, where found, its NZD value on the day. Nothing is saved until
 * you press Save; "Ignore" remembers a transfer so it isn't offered again. Swap legs are shown as
 * one row.
 */
import { useState } from 'react';
import { api, formatNzd } from '../../api/client';
import type { CryptoImportCandidate, CryptoTxnKind } from '../../types';
import { CRYPTO_TXN_KINDS, KIND_LABEL, NEEDS_VALUE } from '../../lib/cryptoGains';

type Row = CryptoImportCandidate & { kind: CryptoTxnKind | 'ignore'; value: string; partner: CryptoImportCandidate | null };
const qty = (n: number) => n.toLocaleString('en-NZ', { maximumFractionDigits: 8 });
/** Symbols the ledger can store (letters, digits, . - _); others are usually spam tokens. */
const usableSymbol = (s: string) => /^[A-Za-z0-9.\-_]{1,20}$/.test(s);

export function CryptoImport({ wallets, onDone }: { wallets: { id: string; name: string; network: string }[]; onDone: (msg: string) => void }) {
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? '');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.crypto.importPreview(walletId);
      const byRef = new Map(r.candidates.map((c) => [c.ref, c]));
      const hidden = new Set<string>();
      const out: Row[] = [];
      for (const c of r.candidates) {
        if (hidden.has(c.ref)) continue;
        // A swap shows once, from the side given away.
        let partner: CryptoImportCandidate | null = null;
        if (c.suggestion.kind === 'swap' && c.suggestion.pairRef) {
          const other = byRef.get(c.suggestion.pairRef) ?? null;
          if (other && c.direction === 'in') continue;
          partner = other;
          if (other) hidden.add(other.ref);
        }
        const odd = !usableSymbol(c.asset) || (partner != null && !usableSymbol(partner.asset));
        out.push({ ...c, kind: odd ? 'ignore' : c.suggestion.kind, value: c.nzdValue == null ? '' : String(c.nzdValue), partner });
      }
      setRows(out);
      setSkipped(r.skipped);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read that wallet.');
    } finally {
      setBusy(false);
    }
  }

  const set = (ref: string, patch: Partial<Row>) => setRows((rs) => rs?.map((r) => (r.ref === ref ? { ...r, ...patch } : r)) ?? null);

  async function save() {
    if (!rows) return;
    setError(null);
    setBusy(true);
    try {
      const items = rows.map((r) =>
        r.kind === 'ignore'
          ? { ref: r.ref, pairRef: r.partner?.ref, kind: 'ignore' }
          : {
              ref: r.ref,
              pairRef: r.kind === 'swap' ? r.partner?.ref : undefined,
              kind: r.kind,
              date: r.date,
              asset: r.asset,
              amount: r.amount,
              nzdValue: r.value.trim() === '' ? null : Number(r.value),
              priceSource: r.value.trim() !== '' && String(r.nzdValue) === r.value ? r.priceSource ?? 'manual' : 'manual',
              toAsset: r.kind === 'swap' ? r.partner?.asset : undefined,
              toAmount: r.kind === 'swap' ? r.partner?.amount : undefined,
              counterparty: r.counterparty,
              notes: '',
            },
      );
      const res = await api.crypto.importCommit(walletId, items);
      setRows(null);
      onDone(`${res.added} added to your ledger${res.ignored ? `, ${res.ignored} ignored` : ''}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save.');
    } finally {
      setBusy(false);
    }
  }

  if (!wallets.length) {
    return <p className="muted small">Add a wallet on Portfolio to import its transactions.</p>;
  }
  return (
    <div className="crypto-import">
      <div className="crypto-import-pick">
        <label>
          Wallet
          <select value={walletId} onChange={(e) => { setWalletId(e.target.value); setRows(null); }}>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.network})</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={busy || !walletId} onClick={() => void find()}>
          {busy && !rows ? 'Reading…' : 'Find transactions'}
        </button>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {rows ? (
        rows.length === 0 ? (
          <p className="muted small">Nothing new{skipped ? ` (${skipped} already imported or ignored)` : ''}.</p>
        ) : (
          <>
            <p className="muted small">Check each one. Suggestions marked “guess” need your eye. NZD values come from Yahoo Finance × Frankfurter for the day; change any you know better. Tokens nobody prices are often unsolicited airdrops.</p>
            <div className="row gap crypto-import-bulk">
              <button type="button" className="btn small ghost" onClick={() => setRows((rs) => rs?.map((r) => (r.suggestion.confident ? r : { ...r, kind: 'ignore' })) ?? null)}>
                Ignore all guesses
              </button>
              <button
                type="button"
                className="btn small ghost"
                onClick={() => setRows((rs) => rs?.map((r) => (r.kind !== 'ignore' && (NEEDS_VALUE.has(r.kind) || r.kind === 'fee') && r.value.trim() === '' ? { ...r, kind: 'ignore' } : r)) ?? null)}
              >
                Ignore all without a value
              </button>
            </div>
            <ul className="crypto-import-list">
              {rows.map((r) => (
                <li key={r.ref} className={r.kind === 'ignore' ? 'crypto-import-ignored' : undefined}>
                  <div className="crypto-import-what">
                    <strong>
                      {r.direction === 'in' ? '+' : '−'}
                      {qty(r.amount)} {r.asset}
                      {r.partner ? ` → +${qty(r.partner.amount)} ${r.partner.asset}` : ''}
                    </strong>
                    <span className="muted small">
                      {r.date} · {r.suggestion.reason}
                      {r.suggestion.confident ? '' : ' (guess)'}
                      {usableSymbol(r.asset) ? '' : ' · unusual token name, ignored'}
                    </span>
                  </div>
                  <label>
                    <span className="sr-only">Kind for {qty(r.amount)} {r.asset} on {r.date}</span>
                    <select value={r.kind} onChange={(e) => set(r.ref, { kind: e.target.value as Row['kind'] })}>
                      {CRYPTO_TXN_KINDS.filter((k) => k !== 'swap' || r.partner).map((k) => (
                        <option key={k} value={k}>{KIND_LABEL[k]}</option>
                      ))}
                      <option value="ignore">Ignore</option>
                    </select>
                  </label>
                  {r.kind !== 'ignore' && (NEEDS_VALUE.has(r.kind) || r.kind === 'fee') ? (
                    <label>
                      <span className="sr-only">NZD value</span>
                      <input type="number" min={0} step="0.01" inputMode="decimal" placeholder="NZD value" value={r.value} onChange={(e) => set(r.ref, { value: e.target.value })} />
                      {r.nzdValue == null && r.priceNote ? <span className="muted small">{r.priceNote}</span> : null}
                      {r.nzdValue != null && r.value === String(r.nzdValue) ? <span className="muted small">{formatNzd(r.nzdValue)} on the day</span> : null}
                    </label>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
            <div className="row gap">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
                Save {rows.filter((r) => r.kind !== 'ignore').length} to the ledger
              </button>
              <button type="button" className="btn ghost" onClick={() => setRows(null)}>
                Cancel
              </button>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}
