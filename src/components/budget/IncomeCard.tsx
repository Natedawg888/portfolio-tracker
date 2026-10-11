/**
 * Compact income card: total received, then one row per income category
 * ("Mining · 7 payments · no plan") that expands to its items, with plan actions.
 */
import { useState } from 'react';
import { formatNzd } from '../../api/client';
import { dailyAverage, type MonthProgress } from '../../lib/budgetView';
import type { IncomeRecord } from '../../types';
import { PlanEditor } from './CategoryBudgetList';

export type IncomeRow = {
  /** Null for income with no category. */
  categoryId: string | null;
  name: string;
  received: number;
  planned: number | null;
  planId: string | null;
  items: IncomeRecord[];
};

function itemType(r: IncomeRecord): string {
  if (r.dividendEventId) return 'Dividend';
  if (r.kind === 'crypto') return 'Crypto';
  if (r.origin === 'category_txn') return 'Bank';
  return 'Cash';
}

export function IncomeCard({
  monthLong,
  progress,
  totalReceived,
  rows,
  expectedPay,
  addable,
  saving,
  onSavePlan,
  onRemovePlan,
  onDeleteItem,
  onAddIncome,
}: {
  monthLong: string;
  progress: MonthProgress;
  /** Null when income could not be loaded. */
  totalReceived: number | null;
  rows: IncomeRow[];
  expectedPay: { monthlyNetNzd: number; names: string[] } | null;
  addable: Array<{ id: string; name: string }>;
  saving: boolean;
  onSavePlan: (categoryId: string, amount: number) => Promise<boolean>;
  onRemovePlan: (planId: string, name: string) => Promise<void>;
  onDeleteItem: (r: IncomeRecord) => void;
  onAddIncome: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addCategory, setAddCategory] = useState('');

  return (
    <section className="panel income-card" aria-labelledby="income-card-title">
      <div className="panel-heading">
        <h3 id="income-card-title">Income</h3>
        <button type="button" className="btn small ghost" onClick={onAddIncome}>
          + Add income
        </button>
      </div>
      <p className="income-card-total">
        <span className="muted small">Received in {monthLong}</span>
        <strong className="money">{formatNzd(totalReceived)}</strong>
      </p>
      {expectedPay ? (
        <p className="muted small income-card-expected">
          Expected from saved pay: {formatNzd(expectedPay.monthlyNetNzd)}/month ({expectedPay.names.join(', ')})
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="muted small">No income or income plans in {monthLong} yet.</p>
      ) : (
        <ul className="income-card-list">
          {rows.map((row) => {
            const key = row.categoryId ?? '__none__';
            const open = openKey === key;
            const editing = planKey === key;
            const count = row.items.length;
            const avg = dailyAverage(row.received, row.items.map((r) => r.date), progress);
            const listId = `income-items-${key}`;
            const over = row.planned != null && row.received > row.planned;
            return (
              <li key={key} className="income-card-row">
                <div className="income-card-row-head">
                  <button
                    type="button"
                    className="income-card-toggle"
                    aria-expanded={open}
                    aria-controls={open ? listId : undefined}
                    disabled={count === 0}
                    onClick={() => setOpenKey(open ? null : key)}
                  >
                    <span className="income-card-name">
                      {row.name}
                      <span className="muted small">
                        {' · '}
                        {count} payment{count === 1 ? '' : 's'}
                        {row.planned == null ? ' · no plan' : ''}
                        {avg != null ? ` · avg ${formatNzd(avg)}/day` : ''}
                      </span>
                    </span>
                    <span className="money">
                      {formatNzd(row.received)}
                      {row.planned != null ? <span className="muted"> of {formatNzd(row.planned)}</span> : null}
                    </span>
                    {count > 0 ? <span aria-hidden="true">{open ? '▴' : '▾'}</span> : null}
                  </button>
                  {row.categoryId && !editing ? (
                    <button type="button" className="btn small ghost" onClick={() => setPlanKey(key)}>
                      {row.planned == null ? 'Set plan' : 'Edit plan'}
                      <span className="sr-only"> for {row.name}</span>
                    </button>
                  ) : null}
                </div>
                {row.planned != null ? (
                  <p className={`income-card-status${over ? ' income-card-status--over' : ''}`}>
                    {over
                      ? `${formatNzd(row.received - row.planned)} more than planned`
                      : `${formatNzd(row.planned - row.received)} still expected`}
                  </p>
                ) : null}
                {editing && row.categoryId ? (
                  <PlanEditor
                    id={`income-plan-${key}`}
                    name={row.name}
                    initial={row.planned != null ? String(row.planned) : ''}
                    saving={saving}
                    onSave={async (amount) => {
                      if (await onSavePlan(row.categoryId!, amount)) setPlanKey(null);
                    }}
                    onRemove={
                      row.planId ? () => onRemovePlan(row.planId!, row.name).then(() => setPlanKey(null)) : undefined
                    }
                    onCancel={() => setPlanKey(null)}
                  />
                ) : null}
                {open ? (
                  <ul id={listId} className="income-card-items">
                    {row.items.map((r) => {
                      const deletable = r.origin !== 'category_txn' && !r.dividendEventId;
                      return (
                        <li key={r.id}>
                          <span className="muted small">{r.date}</span>
                          <span className="income-card-item-desc">
                            {r.description || '—'}
                            <span className="muted small"> · {itemType(r)}</span>
                            {r.kind === 'crypto' && r.cryptoAsset ? (
                              <span className="muted small">
                                {' · '}
                                {r.cryptoAmount ?? '?'} {r.cryptoAsset}
                              </span>
                            ) : null}
                          </span>
                          <span className="amt-in money">{formatNzd(r.amountNzd)}</span>
                          {deletable ? (
                            <button
                              type="button"
                              className="btn small ghost danger"
                              aria-label={`Delete income ${r.description || r.date}`}
                              onClick={() => onDeleteItem(r)}
                            >
                              Delete
                            </button>
                          ) : (
                            <span
                              className="muted small"
                              title={
                                r.dividendEventId
                                  ? 'Update or delete the dividend on Portfolio'
                                  : 'Change the transaction’s category to remove it from income'
                              }
                            >
                              {r.dividendEventId ? 'From dividend' : 'From bank'}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {addable.length > 0 ? (
        addOpen ? (
          <div className="plan-editor plan-editor--add">
            <label htmlFor="income-plan-add-category" className="sr-only">
              Income category to plan
            </label>
            <div className="plan-editor-row">
              <select
                id="income-plan-add-category"
                value={addCategory || addable[0].id}
                onChange={(e) => setAddCategory(e.target.value)}
              >
                {addable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <PlanEditor
              id="income-plan-add"
              name={addable.find((c) => c.id === (addCategory || addable[0].id))?.name ?? 'income'}
              initial=""
              saving={saving}
              onSave={async (amount) => {
                if (await onSavePlan(addCategory || addable[0].id, amount)) setAddOpen(false);
              }}
              onCancel={() => setAddOpen(false)}
            />
          </div>
        ) : (
          <button type="button" className="btn small ghost" onClick={() => setAddOpen(true)}>
            + Plan income for another category
          </button>
        )
      ) : null}
    </section>
  );
}
