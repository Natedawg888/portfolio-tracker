/**
 * Crypto wallet state for Portfolio → Crypto (KAN-44): valuation load, background-sync
 * polling, Sync now and Remove. Rendering lives in components/CryptoWalletCards.tsx.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Wallet, WalletNetwork, WalletsValuationResponse, WalletValuation } from '../types';

export const NETWORK_LABEL: Record<WalletNetwork, string> = {
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  base: 'Base',
  arbitrum: 'Arbitrum',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
};

export const NATIVE_SYMBOL: Record<WalletNetwork, string> = {
  ethereum: 'ETH',
  polygon: 'POL',
  base: 'ETH',
  arbitrum: 'ETH',
  bitcoin: 'BTC',
  solana: 'SOL',
};

/** bc1qfkg0dmlzh39x…l7n5md — enough to recognise, short enough for a card title. */
export function shortAddress(address: string): string {
  return address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return new Date(iso).toLocaleDateString('en-NZ');
}

export function formatWalletAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 8 }).format(n);
}

export type WalletEntry = { wallet: Wallet; valuation: WalletValuation | null };

/** A freshly added / syncing wallet is worth re-checking shortly. */
const needsRefresh = (w: Wallet) => w.status === 'syncing' || (w.status === 'connected' && !w.lastSynced);

export function useCryptoWallets(enabled: boolean) {
  const [data, setData] = useState<WalletsValuationResponse | null>(null);
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: 'sync' | 'remove' } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.wallets.valuation();
      setData(r);
      setEntries(r.wallets);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load wallets');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api.wallets
      .valuation()
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setEntries(r.wallets);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load wallets');
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // The server syncs new wallets in the background; poll briefly until they settle.
  const pending = entries.some((e) => needsRefresh(e.wallet));
  useEffect(() => {
    if (!enabled || !pending) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void load();
      if (tries >= 12) window.clearInterval(timer);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [enabled, pending, load]);

  const patchWallet = (w: Wallet) =>
    setEntries((rows) => rows.map((e) => (e.wallet.id === w.id ? { ...e, wallet: w } : e)));

  const syncNow = async (w: Wallet) => {
    setBusy({ id: w.id, action: 'sync' });
    setNotice(null);
    setError(null);
    patchWallet({ ...w, status: 'syncing' });
    try {
      const r = await api.wallets.sync(w.id);
      if (!r.synced && r.error) setNotice(`${w.name}: ${r.error}`);
      await load();
    } catch (err) {
      patchWallet(w);
      if (err instanceof ApiError && err.status === 429) setNotice(`${w.name}: ${err.message}`);
      else setError(err instanceof ApiError ? err.message : 'Could not sync wallet');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (w: Wallet) => {
    if (!window.confirm(`Remove “${w.name}” (${shortAddress(w.address)})? Only the saved address is deleted — nothing on-chain changes.`)) {
      return;
    }
    setBusy({ id: w.id, action: 'remove' });
    setError(null);
    try {
      await api.wallets.remove(w.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove wallet');
    } finally {
      setBusy(null);
    }
  };

  const added = (w: Wallet) => {
    setEntries((rows) => [...rows, { wallet: w, valuation: null }]);
    void load();
  };

  return { data, entries, error, notice, busy, syncNow, remove, added };
}

export type CryptoWalletsState = ReturnType<typeof useCryptoWallets>;
