/**
 * Household splits and settle-up, phase 3 (KAN-77). SplitEditor splits one shared-account
 * spend equally, by percent or by amount; SettleUp shows who owes whom, suggests the fewest
 * payments, and keeps a history of payments. Adults and the owner make changes; viewers only
 * see. Amounts follow Hide amounts through formatNzd.
 */
import { useId, useState, type FormEvent } from 'react';
import { formatNzd } from '../../api/client';
import type { HouseholdSplitMethod, HouseholdSplitsView } from '../../types';
import { longDate } from '../../pages/warrantiesView';

type Split = HouseholdSplitsView['splits'][number];
type Entry = { memberId: string; value?: number };

const METHODS: { key: HouseholdSplitMethod; label: string }[] = [
  { key: 'equal', label: 'Equal' },
  { key: 'percent', label: 'Percent' },
  { key: 'amount', label: 'Amount' },
];

/** "Split: Olive $42.10 · Adam $42.10" under a split transaction. */
export function SplitLine({ split }: { split: Split }) {
  return <span className="hh-split-line small">Split: {split.shares.map((x) => `${x.name.split(' ')[0]} ${formatNzd(x.amountNzd)}`).join(' · ')}</span>;
}

export function SplitEditor({
  totalNzd,
  members,
  existing,
  onSave,
  onRemove,
  onCancel,
}: {
  totalNzd: number;
  members: HouseholdSplitsView['members'];
  existing: Split | null;
  onSave: (method: HouseholdSplitMethod, shares: Entry[]) => Promise<void>;
  onRemove: (() => Promise<void>) | null;
  onCancel: () => void;
}) {
  const baseId = useId();
  const [method, setMethod] = useState<HouseholdSplitMethod>(existing?.method ?? 'equal');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(existing ? existing.shares.map((s) => s.memberId) : members.map((m) => m.id)));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((existing?.shares ?? []).filter((s) => s.input != null).map((s) => [s.memberId, String(s.input)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = members.filter((m) => picked.has(m.id));
  const sum = chosen.reduce((s, m) => s + (Number(values[m.id]) || 0), 0);
  const target = method === 'percent' ? 100 : totalNzd;
  const remaining = Math.round((target - sum) * 100) / 100;

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (chosen.length < 2) {
      setError('Choose at least two people to split between.');
      return;
    }
    const shares = chosen.map((m) => (method === 'equal' ? { memberId: m.id } : { memberId: m.id, value: Number(values[m.id]) || 0 }));
    setBusy(true);
    try {
      await onSave(method, shares);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the split.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="hh-split-editor" onSubmit={submit}>
      <div className="segmented hh-split-methods" role="group" aria-label="How to split it">
        {METHODS.map((m) => (
          <button key={m.key} type="button" className={'segmented-btn' + (method === m.key ? ' active' : '')} aria-pressed={method === m.key} onClick={() => setMethod(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      <fieldset className="hh-split-people">
        <legend>Split between</legend>
        {members.map((m) => {
          const on = picked.has(m.id);
          const inputId = `${baseId}-${m.id}`;
          return (
            <div key={m.id} className="hh-split-person">
              <label className="hh-share-item">
                <input type="checkbox" checked={on} onChange={(e) => toggle(m.id, e.target.checked)} />
                <span>{m.name}</span>
              </label>
              {on && method !== 'equal' ? (
                <span className="hh-split-value">
                  <label htmlFor={inputId} className="sr-only">
                    {m.name}’s share {method === 'percent' ? '(percent)' : '(NZD)'}
                  </label>
                  {method === 'amount' ? <span aria-hidden="true">$</span> : null}
                  <input
                    id={inputId}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={values[m.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))}
                  />
                  {method === 'percent' ? <span aria-hidden="true">%</span> : null}
                </span>
              ) : null}
              {on && method === 'equal' && chosen.length ? <span className="muted small money">{formatNzd(totalNzd / chosen.length)}</span> : null}
            </div>
          );
        })}
      </fieldset>
      {method !== 'equal' ? (
        <p className={'small' + (remaining === 0 ? ' muted' : ' hh-over')} aria-live="polite">
          {remaining === 0
            ? 'Adds up.'
            : method === 'percent'
              ? `${Math.abs(remaining)}% ${remaining > 0 ? 'still to assign' : 'too much'}`
              : `${formatNzd(Math.abs(remaining))} ${remaining > 0 ? 'still to assign' : 'too much'}`}
        </p>
      ) : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="hh-split-actions">
        <button type="submit" className="btn primary" disabled={busy}>
          {existing ? 'Save split' : 'Split it'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        {onRemove ? (
          <button
            type="button"
            className="btn ghost danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onRemove().finally(() => setBusy(false));
            }}
          >
            Remove split
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function SettleUp({
  view,
  onRecord,
  onRemove,
}: {
  view: HouseholdSplitsView;
  onRecord: (p: { fromId: string; toId: string; amountNzd: number; note?: string }, note: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const owing = view.balances.filter((b) => Math.abs(b.netNzd) >= 0.005);
  const run = (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    void fn().finally(() => setBusy(null));
  };

  return (
    <section className="panel" aria-labelledby="hh-settle-title">
      <h3 id="hh-settle-title">Settle up</h3>
      <p className="muted small">Split spending on shared accounts above. The person who paid is owed everyone else’s share.</p>
      <div className="hh-shared">
        {view.splits.length + view.settlements.length === 0 ? <p className="muted small">Nothing has been split yet.</p> : null}
        {owing.length ? (
          <div className="hh-block">
            <h4>Balances</h4>
            <ul className="hh-rows">
              {owing.map((b) => (
                <li key={b.memberId}>
                  <span>{b.name}</span>
                  <span className={'money ' + (b.netNzd > 0 ? 'hh-owed' : 'hh-owes')}>{b.netNzd > 0 ? `is owed ${formatNzd(b.netNzd)}` : `owes ${formatNzd(-b.netNzd)}`}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : view.splits.length ? (
          <p className="muted small">Everyone is square.</p>
        ) : null}

        {view.suggestions.length ? (
          <div className="hh-block">
            <h4>Suggested payments</h4>
            <ul className="hh-rows">
              {view.suggestions.map((p) => {
                const key = `${p.fromId}>${p.toId}`;
                return (
                  <li key={key}>
                    <span>
                      {p.from} pays {p.to} <span className="money">{formatNzd(p.amountNzd)}</span>
                    </span>
                    {view.canEdit ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy === key}
                        onClick={() =>
                          run(key, () =>
                            onRecord(
                              {
                                fromId: p.fromId,
                                toId: p.toId,
                                amountNzd: p.amountNzd,
                              },
                              `Recorded ${p.from} paying ${p.to}.`,
                            ),
                          )
                        }
                      >
                        Record payment
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {view.settlements.length ? (
          <div className="hh-block">
            <h4>Payments</h4>
            <ul className="hh-rows">
              {view.settlements.map((s) => (
                <li key={s.id}>
                  <span>
                    {s.from} paid {s.to}{' '}
                    <span className="muted small">
                      · {longDate(s.paidOn)}
                      {s.note ? ` · ${s.note}` : ''}
                    </span>
                  </span>
                  <span className="hh-settle-end">
                    <span className="money">{formatNzd(s.amountNzd)}</span>
                    {view.canEdit ? (
                      <button
                        type="button"
                        className="link-btn"
                        disabled={busy === s.id}
                        aria-label={`Remove payment from ${s.from} to ${s.to}`}
                        onClick={() => run(s.id, () => onRemove(s.id))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
