/**
 * Bills & subscriptions (KAN-27). Reached from the Budget page (not the nav bar).
 * Lists repeating payments found in the user's transactions to confirm or dismiss,
 * and the bills / subscriptions they have saved, with next due date and amount.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, formatNzd, type RecurringWriteBody } from '../api/client';
import { CADENCES, CADENCE_LABELS, type Cadence } from '../lib/recurring';
import type { RecurringItem, RecurringListResponse } from '../types';

type Suggestion = RecurringListResponse['suggestions'][number];
type Category = { id: string; name: string; type: string };

function formatDate(ymd: string | null): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function dueText(nextDue: string, today: string): string {
  const days = Math.round((Date.parse(`${nextDue}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 1 && days <= 14) return `Due in ${days} days`;
  return formatDate(nextDue);
}

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
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<RecurringListResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    api.recurring
      .list()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errText(e, 'Could not load bills and subscriptions.'));
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

  // Back to wherever the user came from (normally Budget); Budget when opened directly.
  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/spending');
  };

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
  const t = data?.totals;
  const active = data?.items.filter((i) => i.status === 'active') ?? [];
  const inactive = data?.items.filter((i) => i.status !== 'active') ?? [];

  const blank: Draft = { name: '', kind: 'bill', amount: '', cadence: 'monthly', nextDue: today, categoryId: '', notes: '' };

  return (
    <div className="stack bills-page">
      <div>
        <button type="button" className="btn small ghost bills-back" onClick={goBack}>
          ← Back to Budget
        </button>
      </div>
      <section className="hero-card hero-card--centered">
        <h2 className="page-title">Bills &amp; subscriptions</h2>
        <p className="page-lead">
          Repeating payments found in your transactions, and the ones you&apos;ve saved. Confirm what&apos;s right,
          dismiss what isn&apos;t, and see what&apos;s due next.
        </p>
        <div className="row gap" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn primary" onClick={() => setDialog({ mode: 'add' })} disabled={!data}>
            Add a bill or subscription
          </button>
        </div>
      </section>

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
          <section className="grid cards" aria-label="Totals">
            <div className="card">
              <p className="eyebrow">Each month</p>
              <p className="stat-value">{t ? formatNzd(t.monthlyNzd) : '—'}</p>
              <p className="muted small">{t?.activeCount ?? 0} active</p>
            </div>
            <div className="card">
              <p className="eyebrow">Each year</p>
              <p className="stat-value">{t ? formatNzd(t.yearlyNzd) : '—'}</p>
            </div>
            <div className="card">
              <p className="eyebrow">Due in the next 30 days</p>
              <p className="stat-value">{t ? formatNzd(t.dueNext30DaysNzd) : '—'}</p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h3>Found in your transactions</h3>
              {data.dismissedCount > 0 ? (
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={busyKey != null}
                  onClick={() => void act('restore', () => api.recurring.restoreDismissed(), 'Dismissed suggestions are back.')}
                >
                  Show {data.dismissedCount} dismissed
                </button>
              ) : null}
            </div>
            {data.suggestions.length === 0 ? (
              <p className="muted small">
                Nothing new to review. Payments show up here once the same payee has been paid at least three times on a
                regular schedule (twice for yearly).
              </p>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Payee</th>
                      <th>How often</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Next due</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.suggestions.map((s) => (
                      <tr key={s.merchantKey}>
                        <td>
                          {s.name}
                          <div className="muted small">
                            {s.kind === 'subscription' ? 'Subscription' : 'Bill'} · {s.occurrences} payments, last {formatDate(s.lastDate)}
                            {s.amountVaries ? ' · amount varies' : ''}
                          </div>
                        </td>
                        <td>{CADENCE_LABELS[s.cadence]}</td>
                        <td className="money" style={{ textAlign: 'right' }}>
                          {formatNzd(s.amountNzd)}
                        </td>
                        <td>{dueText(s.nextDue, today)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button type="button" className="btn small primary" disabled={busyKey != null} onClick={() => setDialog({ mode: 'confirm', suggestion: s })}>
                            Confirm
                          </button>{' '}
                          <button
                            type="button"
                            className="btn small"
                            disabled={busyKey != null}
                            onClick={() => void act(s.merchantKey, () => api.recurring.dismiss(s.merchantKey), `${s.name} won’t be suggested again.`)}
                          >
                            Not a bill
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h3>Your bills &amp; subscriptions</h3>
            {data.items.length === 0 ? (
              <p className="muted small">
                None saved yet. Confirm one found above, or use <strong>Add a bill or subscription</strong>.
              </p>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>How often</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>Per month</th>
                      <th>Next due</th>
                      <th>Last paid</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {[...active, ...inactive].map((i) => (
                      <tr key={i.id} className={i.status !== 'active' ? 'bills-inactive' : undefined}>
                        <td>
                          {i.name}
                          <div className="muted small">
                            {i.kind === 'subscription' ? 'Subscription' : 'Bill'}
                            {i.categoryName ? ` · ${i.categoryName}` : ''}
                            {i.status !== 'active' ? ` · ${i.status === 'paused' ? 'Paused' : 'Cancelled'}` : ''}
                            {i.notes ? ` · ${i.notes}` : ''}
                          </div>
                        </td>
                        <td>{CADENCE_LABELS[i.cadence]}</td>
                        <td className="money" style={{ textAlign: 'right' }}>
                          {formatNzd(i.amountNzd)}
                        </td>
                        <td className="money" style={{ textAlign: 'right' }}>
                          {formatNzd(i.monthlyNzd)}
                        </td>
                        <td>{i.status === 'active' ? dueText(i.nextDue, today) : '—'}</td>
                        <td>
                          {i.lastPaidDate ? (
                            <>
                              {formatDate(i.lastPaidDate)}
                              <div className="muted small">{formatNzd(i.lastPaidNzd)}</div>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button type="button" className="btn small" disabled={busyKey != null} onClick={() => setDialog({ mode: 'edit', item: i })}>
                            Edit
                          </button>{' '}
                          <button
                            type="button"
                            className="btn small"
                            disabled={busyKey != null}
                            onClick={() =>
                              void act(i.id, () => api.recurring.update(i.id, { status: i.status === 'active' ? 'paused' : 'active' }), i.status === 'active' ? `${i.name} paused.` : `${i.name} is active again.`)
                            }
                          >
                            {i.status === 'active' ? 'Pause' : 'Resume'}
                          </button>{' '}
                          <button
                            type="button"
                            className="btn small danger"
                            disabled={busyKey != null}
                            onClick={() => void act(i.id, () => api.recurring.remove(i.id), `${i.name} removed.`, `Remove ${i.name}?`)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
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
          title={`Confirm ${dialog.suggestion.name}`}
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
          saveLabel="Save"
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.recurring.create({ ...body, merchantKey: dialog.suggestion.merchantKey, source: 'detected' });
            setDialog(null);
            setMsg(`${body.name} saved.`);
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
