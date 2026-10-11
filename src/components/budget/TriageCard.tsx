/**
 * "N transactions need a category": uncategorised transactions this month with
 * one-tap category buttons (most likely first and highlighted) and a full picker.
 * Picking saves through the same path as the transactions list, so every total updates.
 */
import { useId, useState } from 'react';
import { formatNzd } from '../../api/client';
import { maskAccountNumbers } from '../../lib/accountMask';
import type { Transaction, TxnCategorySuggestions } from '../../types';

const SHOWN_AT_FIRST = 6;

type Cat = { id: string; name: string };

export function TriageCard({
  txns,
  suggestions,
  categories,
  savingId,
  onPick,
}: {
  /** Uncategorised transactions for the month. */
  txns: Transaction[];
  suggestions: TxnCategorySuggestions[];
  categories: Array<Cat & { tag: string | null }>;
  savingId: string | null;
  onPick: (txnId: string, categoryId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const byTxn = new Map(suggestions.map((s) => [s.transactionId, s.suggestions]));
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const shown = showAll ? txns : txns.slice(0, SHOWN_AT_FIRST);

  if (txns.length === 0) {
    return (
      <section className="card triage-card triage-card--done" aria-label="Transactions needing a category">
        <p>
          <span aria-hidden="true">✓ </span>Every transaction this month has a category.
        </p>
      </section>
    );
  }

  return (
    <section className="card triage-card" aria-labelledby="triage-title">
      <h3 id="triage-title" className="triage-title">
        {txns.length} transaction{txns.length === 1 ? '' : 's'} need{txns.length === 1 ? 's' : ''} a category
      </h3>
      <ul id={listId} className="triage-list">
        {shown.map((t) => {
          const amount = Number(t.amount);
          const picks = (byTxn.get(t.id) ?? []).filter((s) => nameOf.has(s.categoryId));
          const busy = savingId === t.id;
          const account = t.accountName ? maskAccountNumbers(t.accountName) : t.cardName || 'Not charged to an account';
          return (
            <li key={t.id} className="triage-item">
              <div className="triage-item-main">
                <span className="triage-desc">{t.description || '(no description)'}</span>
                <span className="muted small">
                  {t.date} · {account}
                </span>
              </div>
              <span className={`money ${amount < 0 ? 'amt-out' : 'amt-in'}`}>
                {amount > 0 ? '+' : ''}
                {formatNzd(amount)}
              </span>
              <div className="triage-picks" role="group" aria-label={`Category for ${t.description || t.date}`}>
                {picks.map((p, i) => (
                  <button
                    key={p.categoryId}
                    type="button"
                    className={`btn small${i === 0 ? ' primary' : ''}`}
                    disabled={busy}
                    onClick={() => onPick(t.id, p.categoryId)}
                  >
                    {nameOf.get(p.categoryId)}
                    {i === 0 ? <span className="sr-only"> (most likely)</span> : null}
                  </button>
                ))}
                <OtherPicker
                  txnLabel={t.description || t.date}
                  categories={categories}
                  disabled={busy}
                  onPick={(categoryId) => onPick(t.id, categoryId)}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {txns.length > SHOWN_AT_FIRST ? (
        <button
          type="button"
          className="btn small ghost"
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show fewer' : `Show all ${txns.length}`}
        </button>
      ) : null}
    </section>
  );
}

function OtherPicker({
  txnLabel,
  categories,
  disabled,
  onPick,
}: {
  txnLabel: string;
  categories: Array<Cat & { tag: string | null }>;
  disabled: boolean;
  onPick: (categoryId: string) => void;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Other category for {txnLabel}
      </label>
      <select
        id={id}
        className="triage-other"
        value=""
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
      >
        <option value="">Other…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.tag ? ` (${c.tag})` : ''}
          </option>
        ))}
      </select>
    </>
  );
}
