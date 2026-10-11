/**
 * Budget transactions: filter pills, the latest N with "See all", and one row per
 * transaction (date, description + account, category chip, amount, ⋯ menu).
 */
import { useId, useState } from 'react';
import { formatNzd } from '../../api/client';
import { maskAccountNumbers } from '../../lib/accountMask';
import { categoryDirectionMismatch, type CategoryType } from '../../lib/categoryTypes';
import { matchesTxnFilter, type TxnFilter } from '../../lib/budgetView';
import { isCharityCategoryId } from '../../lib/charityPayeLink';
import type { Transaction } from '../../types';
import { MoreMenu } from '../MoreMenu';

const TXNS_SHOWN_AT_FIRST = 20;

export type ListCategory = { id: string; name: string; type: CategoryType; tag: string | null; colour: string | null };

const SOURCE_LABELS: Record<string, string> = {
  akahu: 'Akahu',
  bank: 'Bank',
  google_wallet: 'Wallet',
  csv: 'CSV',
  manual: 'Manual',
};

/** "Main · ••••286-01", or "Nexo card · Not charged"; card and account merged when they match. */
function accountLine(t: Transaction): string {
  const card = (t.cardName ?? '').trim();
  const account = (t.accountName ?? '').trim();
  const parts: string[] = [];
  if (card && card.toLowerCase() !== account.toLowerCase()) parts.push(card);
  parts.push(account || (t.accountId ? t.accountId : 'Not charged to an account'));
  return maskAccountNumbers(parts.join(' · '));
}

function btcLine(t: Transaction): string | null {
  if (!t.affectsBtc) return null;
  const delta =
    t.btcDeltaApplied != null ? `${t.btcDeltaApplied < 0 ? '−' : '+'}${Math.abs(t.btcDeltaApplied).toFixed(6)} BTC` : 'BTC';
  return t.btcHoldingName ? `${delta} · ${t.btcHoldingName}` : delta;
}

function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function TransactionList({
  monthLong,
  txns,
  categories,
  filter,
  onFilterChange,
  savingId,
  onCategoryChange,
  onDelete,
  onCharityReceipt,
  onAdd,
}: {
  monthLong: string;
  txns: Transaction[];
  categories: ListCategory[];
  filter: TxnFilter;
  onFilterChange: (f: TxnFilter) => void;
  savingId: string | null;
  onCategoryChange: (txnId: string, categoryId: string) => void;
  onDelete: (t: Transaction) => void;
  onCharityReceipt: (t: Transaction) => void;
  onAdd: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const typeOf = new Map(categories.map((c) => [c.id, c.type]));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const filtered = txns.filter((t) => matchesTxnFilter(t, filter, typeOf));
  const shown = showAll ? filtered : filtered.slice(0, TXNS_SHOWN_AT_FIRST);
  const needsCount = txns.filter((t) => matchesTxnFilter(t, { kind: 'needs' }, typeOf)).length;
  const transferCount = txns.filter((t) => matchesTxnFilter(t, { kind: 'transfers' }, typeOf)).length;
  const categoryFilterName = filter.kind === 'category' ? (byId.get(filter.categoryId)?.name ?? 'Category') : null;

  const pill = (label: string, f: TxnFilter, count?: number) => {
    const active = filter.kind === f.kind;
    return (
      <button
        type="button"
        className={'txn-pill' + (active ? ' active' : '')}
        aria-pressed={active}
        onClick={() => {
          setShowAll(false);
          onFilterChange(f);
        }}
      >
        {label}
        {count != null ? <span className="txn-pill-count"> {count}</span> : null}
      </button>
    );
  };

  return (
    <section className="panel txn-list-panel" id="budget-transactions" aria-labelledby="txn-list-title">
      <div className="panel-heading">
        <h3 id="txn-list-title">Transactions</h3>
        <button type="button" className="btn small ghost" onClick={onAdd}>
          + Add transaction
        </button>
      </div>
      <div className="txn-pills" role="group" aria-label="Filter transactions">
        {pill('All', { kind: 'all' }, txns.length)}
        {pill('Needs category', { kind: 'needs' }, needsCount)}
        {pill('Transfers', { kind: 'transfers' }, transferCount)}
        {categoryFilterName ? (
          <span className="txn-pill active txn-pill--category">
            {categoryFilterName}
            <button
              type="button"
              className="txn-pill-clear"
              aria-label={`Clear ${categoryFilterName} filter`}
              onClick={() => onFilterChange({ kind: 'all' })}
            >
              ×
            </button>
          </span>
        ) : null}
      </div>

      {txns.length === 0 ? (
        <p className="muted">No transactions in {monthLong}. Sync your bank, add one, or pick another month.</p>
      ) : filtered.length === 0 ? (
        <p className="muted">Nothing matches this filter in {monthLong}.</p>
      ) : (
        <ul id={listId} className="txn-list">
          {shown.map((t) => {
            const amount = Number(t.amount);
            const cat = t.categoryId ? byId.get(t.categoryId) : undefined;
            const mismatch = cat ? categoryDirectionMismatch(cat.type, amount) : false;
            const btc = btcLine(t);
            return (
              <li key={t.id} className="txn-row">
                <span className="txn-date muted small">{shortDate(t.date)}</span>
                <span className="txn-main">
                  <span className="txn-desc" title={t.description || undefined}>
                    {t.description || '(no description)'}
                  </span>
                  <span className="muted small">
                    {accountLine(t)}
                    {t.source ? ` · ${SOURCE_LABELS[t.source] ?? t.source}` : ''}
                    {btc ? ` · ${btc}` : ''}
                  </span>
                </span>
                <span className="txn-cat">
                  {cat ? (
                    <span className="txn-chip">
                      {cat.colour ? <span className="category-dot" style={{ background: cat.colour }} aria-hidden="true" /> : null}
                      {cat.name}
                    </span>
                  ) : (
                    <span className="txn-chip txn-chip--needs">Needs category</span>
                  )}
                  {mismatch ? (
                    <span
                      className="txn-direction-flag"
                      title={
                        amount > 0
                          ? 'Money came in, but this category is for money going out.'
                          : 'Money went out, but this category is for money coming in.'
                      }
                    >
                      <span aria-hidden="true">⚠ </span>Check direction
                      <span className="sr-only">
                        {amount > 0
                          ? ': money came in, but this category is for money going out'
                          : ': money went out, but this category is for money coming in'}
                      </span>
                    </span>
                  ) : null}
                </span>
                <span className={`txn-amount money ${amount < 0 ? 'amt-out' : 'amt-in'}`}>
                  {amount > 0 ? '+' : ''}
                  {formatNzd(amount)}
                </span>
                <RowMenu
                  txn={t}
                  categories={categories}
                  saving={savingId === t.id}
                  onCategoryChange={onCategoryChange}
                  onDelete={onDelete}
                  onCharityReceipt={onCharityReceipt}
                />
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > TXNS_SHOWN_AT_FIRST ? (
        <button
          type="button"
          className="btn small ghost txn-see-all"
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? `Show latest ${TXNS_SHOWN_AT_FIRST}` : `See all ${filtered.length}`}
        </button>
      ) : null}
    </section>
  );
}

function RowMenu({
  txn,
  categories,
  saving,
  onCategoryChange,
  onDelete,
  onCharityReceipt,
}: {
  txn: Transaction;
  categories: ListCategory[];
  saving: boolean;
  onCategoryChange: (txnId: string, categoryId: string) => void;
  onDelete: (t: Transaction) => void;
  onCharityReceipt: (t: Transaction) => void;
}) {
  const selectId = useId();
  return (
    <MoreMenu label={`Actions for ${txn.description || txn.date}`}>
      {(close) => (
        <>
          <label htmlFor={selectId}>Category</label>
          <select
            id={selectId}
            value={txn.categoryId ?? ''}
            disabled={saving}
            onChange={(e) => {
              onCategoryChange(txn.id, e.target.value);
              close();
            }}
          >
            <option value="">— Uncategorised —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.tag ? ` (${c.tag})` : ''}
              </option>
            ))}
          </select>
          {isCharityCategoryId(txn.categoryId) ? (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                close();
                onCharityReceipt(txn);
              }}
            >
              {txn.receiptUrl ? 'Charity receipt' : 'Add charity receipt'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn small danger"
            onClick={() => {
              close();
              onDelete(txn);
            }}
          >
            Delete transaction
          </button>
        </>
      )}
    </MoreMenu>
  );
}
