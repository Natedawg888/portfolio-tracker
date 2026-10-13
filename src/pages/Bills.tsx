/**
 * Bills & subscriptions (KAN-27). Reached from the Budget page (not the nav bar).
 * Lists repeating payments found in the user's transactions to confirm or dismiss,
 * and the bills / subscriptions they have saved, with next due date and amount.
 * Phase 1: header and one summary card. Totals are the list response, not recomputed here.
 * Phase 2: the summary card adds a 30-day calendar strip and a "Coming up" list.
 * Phase 3: suggestions are cards (Track / Not a subscription), shown only when there are some.
 * Phase 4: one card per saved bill, with a possible payment to link and a note when Debts has the same creditor.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type RecurringWriteBody } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { showQuietToast } from '../lib/quietToast';
import { BillCard } from '../components/bills/BillCard';
import { BillsSummary } from '../components/bills/BillsSummary';
import { SuggestionCard } from '../components/bills/SuggestionCard';
import { CADENCES, CADENCE_LABELS, type Cadence } from '../lib/recurring';
import type { DebtPerson, RecurringItem, RecurringListResponse } from '../types';
import { billColours, billsSubtitle, creditorFor, headerCounts, orderBills } from './billsView';

type Suggestion = RecurringListResponse['suggestions'][number];

const BILLS_KEY = 'bills';
type Category = { id: string; name: string; type: string };

function errText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn small modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Draft = { name: string; kind: RecurringItem['kind']; amount: string; cadence: Cadence; nextDue: string; categoryId: string; notes: string };

function ItemDialog({
  title,
  initial,
  categories,
  saveLabel,
  onSave,
  onClose,
}: {
  title: string;
  initial: Draft;
  categories: Category[];
  saveLabel: string;
  onSave: (body: RecurringWriteBody) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: d.name,
        kind: d.kind,
        amountNzd: Number(d.amount),
        cadence: d.cadence,
        nextDue: d.nextDue,
        categoryId: d.categoryId || null,
        notes: d.notes,
      });
    } catch (e) {
      setError(errText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid">
        <label className="span-2">
          Name
          <input value={d.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Type
          <select value={d.kind} onChange={(e) => set('kind', e.target.value as Draft['kind'])}>
            <option value="bill">Bill</option>
            <option value="subscription">Subscription</option>
          </select>
        </label>
        <label>
          Amount (NZD)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.amount} onChange={(e) => set('amount', e.target.value)} />
        </label>
        <label>
          How often
          <select value={d.cadence} onChange={(e) => set('cadence', e.target.value as Cadence)}>
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {CADENCE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Next due
          <input type="date" value={d.nextDue} onChange={(e) => set('nextDue', e.target.value)} />
        </label>
        <label className="span-2">
          Budget category (optional)
          <select value={d.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Notes (optional)
          <input value={d.notes} maxLength={500} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !d.name.trim() || !(Number(d.amount) > 0) || !d.nextDue} onClick={() => void save()}>
          {saveLabel}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

type DialogState =
  | { mode: 'add' }
  | { mode: 'confirm'; suggestion: Suggestion }
  | { mode: 'edit'; item: RecurringItem }
  | null;

export function Bills() {
  // Last list from this session shows at once; a fresh one replaces it.
  const [data, setData] = useState<RecurringListResponse | null>(() => readPageCache<RecurringListResponse>(BILLS_KEY) ?? null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [debts, setDebts] = useState<DebtPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    const stamp = beginPageRead(BILLS_KEY);
    api.recurring
      .list()
      .then((d) => {
        if (!commitPageRead(stamp, d) || cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (readPageCache<RecurringListResponse>(BILLS_KEY) != null) {
          showQuietToast('Could not refresh bills — showing last data.', { kind: 'warn' });
          return;
        }
        setError(errText(e, 'Could not load bills and subscriptions.'));
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    api.debts
      .people()
      .then((rows) => {
        if (!cancelled) setDebts(rows);
      })
      .catch(() => {
        /* the "You also owe" note is optional */
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    api.budgets
      .categories()
      .then((rows) => {
        if (!cancelled) setCategories(rows.filter((c) => c.type === 'spending').map((c) => ({ id: c.id, name: c.name, type: c.type })));
      })
      .catch(() => {
        /* the dialog still works without categories */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(key: string, fn: () => Promise<unknown>, note: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyKey(key);
    setMsg(null);
    try {
      await fn();
      setMsg(note);
      load();
    } catch (e) {
      setError(errText(e, 'Something went wrong.'));
    } finally {
      setBusyKey(null);
    }
  }

  const today = data?.today ?? '';
  const colours = billColours(data?.items ?? []);
  const subtitle = data ? billsSubtitle(headerCounts(data.items)) : null;

  const blank: Draft = { name: '', kind: 'bill', amount: '', cadence: 'monthly', nextDue: today, categoryId: '', notes: '' };

  return (
    <div className="stack bills-page">
      <header className="bills-header">
        <div className="bills-header-copy">
          <Link to="/spending" className="bills-back">
            <span aria-hidden="true">‹ </span>Budget
          </Link>
          <h2 className="page-title">Bills &amp; subscriptions</h2>
          {subtitle ? <p className="bills-subtitle">{subtitle}</p> : null}
        </div>
        <button type="button" className="btn primary" onClick={() => setDialog({ mode: 'add' })} disabled={!data}>
          + Add bill
        </button>
      </header>

      {error ? (
        <section className="panel">
          <p className="auth-error" role="alert">{error}</p>
          <button type="button" className="btn small" onClick={load}>
            Try again
          </button>
        </section>
      ) : null}
      {msg ? <p className="banner">{msg}</p> : null}
      {!data && !error ? <p className="muted">Loading bills and subscriptions…</p> : null}

      {data ? (
        <>
          <BillsSummary totals={data.totals} items={data.items} today={today} />

          {data.suggestions.length > 0 ? (
            <section className="bills-suggestions" aria-labelledby="bills-suggestions-title">
              <h3 id="bills-suggestions-title">Found in your transactions</h3>
              <div className="bills-suggestion-grid">
                {data.suggestions.map((s) => (
                  <SuggestionCard
                    key={s.merchantKey}
                    suggestion={s}
                    today={today}
                    busy={busyKey != null}
                    onTrack={() => setDialog({ mode: 'confirm', suggestion: s })}
                    onDismiss={() => void act(s.merchantKey, () => api.recurring.dismiss(s.merchantKey), `${s.name} won’t be suggested again.`)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="bills-list" aria-labelledby="bills-list-title">
            <h3 id="bills-list-title">Your bills &amp; subscriptions</h3>
            {data.items.length === 0 ? (
              <p className="muted small">
                None saved yet. Track one found above, or use <strong>+ Add bill</strong>.
              </p>
            ) : (
              <div className="bills-card-list">
                {orderBills(data.items).map((i) => (
                  <BillCard
                    key={i.id}
                    bill={i}
                    today={today}
                    colourIndex={colours.get(i.id)}
                    creditor={creditorFor(i.name, debts)}
                    busy={busyKey != null}
                    onTogglePause={() =>
                      void act(i.id, () => api.recurring.update(i.id, { status: i.status === 'active' ? 'paused' : 'active' }), i.status === 'active' ? `${i.name} paused.` : `${i.name} is active again.`)
                    }
                    onEdit={() => setDialog({ mode: 'edit', item: i })}
                    onRemove={() => void act(i.id, () => api.recurring.remove(i.id), `${i.name} removed.`, `Remove ${i.name}?`)}
                    onLink={(transactionId) => void act(i.id, () => api.recurring.link(i.id, transactionId), `Payment linked to ${i.name}.`)}
                  />
                ))}
              </div>
            )}
          </section>

          {data.dismissedCount > 0 ? (
            <p className="bills-dismissed">
              <button
                type="button"
                className="link-btn"
                disabled={busyKey != null}
                onClick={() => void act('restore', () => api.recurring.restoreDismissed(), 'Dismissed suggestions are back.')}
              >
                Show {data.dismissedCount} dismissed {data.dismissedCount === 1 ? 'suggestion' : 'suggestions'}
              </button>
            </p>
          ) : null}
        </>
      ) : null}

      {dialog?.mode === 'add' ? (
        <ItemDialog
          title="Add a bill or subscription"
          initial={blank}
          categories={categories}
          saveLabel="Add"
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.recurring.create({ ...body, source: 'manual' });
            setDialog(null);
            setMsg(`${body.name} added.`);
            load();
          }}
        />
      ) : null}
      {dialog?.mode === 'confirm' ? (
        <ItemDialog
          title={`Track ${dialog.suggestion.name}`}
          initial={{
            name: dialog.suggestion.name,
            kind: dialog.suggestion.kind,
            amount: String(dialog.suggestion.amountNzd),
            cadence: dialog.suggestion.cadence,
            nextDue: dialog.suggestion.nextDue,
            categoryId: dialog.suggestion.categoryId && categories.some((c) => c.id === dialog.suggestion.categoryId) ? dialog.suggestion.categoryId : '',
            notes: '',
          }}
          categories={categories}
          saveLabel="Track"
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.recurring.create({ ...body, merchantKey: dialog.suggestion.merchantKey, source: 'detected' });
            setDialog(null);
            setMsg(`${body.name} is being tracked.`);
            load();
          }}
        />
      ) : null}
      {dialog?.mode === 'edit' ? (
        <ItemDialog
          title={`Edit ${dialog.item.name}`}
          initial={{
            name: dialog.item.name,
            kind: dialog.item.kind,
            amount: String(dialog.item.amountNzd),
            cadence: dialog.item.cadence,
            nextDue: dialog.item.nextDue,
            categoryId: dialog.item.categoryId ?? '',
            notes: dialog.item.notes,
          }}
          categories={categories}
          saveLabel="Save"
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.recurring.update(dialog.item.id, body);
            setDialog(null);
            setMsg(`${body.name} updated.`);
            load();
          }}
        />
      ) : null}
    </div>
  );
}
