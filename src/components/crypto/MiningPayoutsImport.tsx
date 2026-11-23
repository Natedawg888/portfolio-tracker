/**
 * Mining payouts already recorded in Income (Income → Mining, e.g. GoMining daily BTC) that aren't
 * in the crypto ledger yet (KAN-94). Adding them makes each one a mining reward: income in its tax
 * year at the NZD value recorded, which is also its cost when it's later sold.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, formatNzd } from '../../api/client';

type Payout = { id: string; date: string; asset: string; amount: number; nzdValue: number; description: string };

export function MiningPayoutsImport({ onDone }: { onDone: (message: string) => void }) {
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.crypto
      .miningPayouts()
      .then((r) => setPayouts(r.payouts))
      .catch(() => setPayouts([]));
  }, []);
  useEffect(load, [load]);

  if (!payouts?.length) return null;
  const total = payouts.reduce((s, p) => s + p.nzdValue, 0);
  return (
    <div className="banner crypto-mining-import" role="note">
      <p className="small">
        {payouts.length === 1 ? '1 mining payout' : `${payouts.length} mining payouts`} in Income ({formatNzd(total)}) aren’t in this ledger yet. IRD
        usually taxes mined crypto when you receive it, at its NZD value, which is also its cost when you sell.
      </p>
      {error ? <p className="auth-error small">{error}</p> : null}
      <button
        type="button"
        className="btn small primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          api.crypto
            .importMiningPayouts(payouts.map((p) => p.id))
            .then((r) => {
              onDone(`${r.added} mining ${r.added === 1 ? 'reward' : 'rewards'} added.`);
              load();
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not add them.'))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Adding…' : 'Add them as mining rewards'}
      </button>
    </div>
  );
}
