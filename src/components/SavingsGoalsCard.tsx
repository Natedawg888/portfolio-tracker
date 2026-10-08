import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api, formatNzd } from '../api/client';
import { beginPageRead, commitPageRead, invalidateFinancial, readPageCache } from '../lib/pageDataCache';
import { usePageCacheValue } from '../lib/usePageCache';
import { showQuietToast } from '../lib/quietToast';
import { useMoneyHidden } from '../lib/privacy';
import type { SavingsGoal } from '../types';

/** Same cap the API enforces (server/savings/model.ts). */
const NOTES_MAX = 500;

type GoalAccount = { id: string; label: string };

/** NZD bank accounts that can hold a goal's savings. */
async function loadGoalAccounts(): Promise<GoalAccount[]> {
  const rows = (await api.accounts.list()) as Array<{ id: string; name?: string; institution?: string; currency?: string }>;
  return rows
    .filter((a) => (a.currency ?? 'NZD').toUpperCase() === 'NZD')
    .map((a) => ({ id: a.id, label: [a.name, a.institution].filter(Boolean).join(' · ') || a.id }));
}

function formatDeadline(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "By 30 Jun 2027 · 265 days left · $1,000.00/month", or the deadline having passed. */
function deadlineLine(goal: SavingsGoal): string | null {
  if (!goal.deadline) return null;
  const date = formatDeadline(goal.deadline);
  if (goal.daysRemaining != null && goal.daysRemaining < 0) return `Deadline ${date} has passed`;
  const parts = [`By ${date}`];
  if (goal.daysRemaining != null) parts.push(goal.daysRemaining === 1 ? '1 day left' : `${goal.daysRemaining} days left`);
  if (goal.remainingNzd > 0 && goal.requiredMonthlySavingNzd != null) parts.push(`${formatNzd(goal.requiredMonthlySavingNzd)}/month`);
  return parts.join(' · ');
}

type DialogState = { mode: 'add' } | { mode: 'edit'; goal: SavingsGoal };

function goalsErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** NZD to cents, matching the savings-goals API rounding. */
function roundNzd(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parsePositiveNzd(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const cents = roundNzd(n);
  return cents > 0 ? cents : null;
}

function parseSavedNzd(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const cents = roundNzd(n);
  return cents >= 0 ? cents : null;
}

/** percentComplete is a percent (25 means 25%) and may exceed 100. The bar stops at full. */
function barPercent(percentComplete: number): number {
  if (!Number.isFinite(percentComplete) || percentComplete <= 0) return 0;
  if (percentComplete >= 100) return 100;
  return percentComplete;
}

const SAVINGS_GOALS = 'savings-goals';

export function SavingsGoalsCard() {
  const cachedGoals = usePageCacheValue<SavingsGoal[]>(SAVINGS_GOALS);
  const [goalsState, setGoals] = useState<SavingsGoal[] | null>(() => readPageCache<SavingsGoal[]>(SAVINGS_GOALS) ?? null);
  const goals = goalsState ?? cachedGoals ?? null;
  const [error, setError] = useState<string | null>(null);
  const goalsRef = useRef(goals);
  useEffect(() => {
    goalsRef.current = goals;
  }, [goals]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // Hide amounts also hides the bar: its length would reveal saved ÷ target.
  const moneyHidden = useMoneyHidden();

  const refresh = useCallback(async () => {
    const stamp = beginPageRead(SAVINGS_GOALS);
    try {
      const rows = await api.savingsGoals.list();
      if (!commitPageRead(stamp, rows)) return;
      setGoals(rows);
      setError(null);
    } catch (err) {
      if (isUnauthorized(err)) return;
      if (goalsRef.current || readPageCache<SavingsGoal[]>(SAVINGS_GOALS) != null) {
        showQuietToast('Could not refresh savings goals — showing last data.', { kind: 'warn' });
        return;
      }
      setError(goalsErrorMessage(err, 'Could not load savings goals.'));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const closeDialog = useCallback(() => setDialog(null), []);

  const card = (
    <section className="card savings-goals" aria-labelledby="savings-goals-heading">
      <div className="savings-goals-head">
        <h2 id="savings-goals-heading" className="savings-goals-title">Savings goals</h2>
        {goals && goals.length > 0 ? (
          <button type="button" className="btn primary" onClick={() => setDialog({ mode: 'add' })}>
            Add goal
          </button>
        ) : null}
      </div>

      {error && goals == null ? (
        <p className="month-snapshot-error" role="alert">{error}</p>
      ) : goals == null ? (
        <p className="month-snapshot-status">Loading savings goals…</p>
      ) : goals.length === 0 ? (
        <div className="savings-goals-empty-wrap">
          <p className="savings-goals-empty">No goals yet</p>
          <button type="button" className="btn primary" onClick={() => setDialog({ mode: 'add' })}>
            Add goal
          </button>
        </div>
      ) : (
        <ul className="savings-goals-list">
          {goals.map((goal) => {
            const fill = barPercent(goal.percentComplete);
            return (
              <li key={goal.id} className="savings-goal">
                <div className="savings-goal-top">
                  <h3 className="savings-goal-name">{goal.name}</h3>
                  <button
                    type="button"
                    className="savings-goal-edit"
                    onClick={() => setDialog({ mode: 'edit', goal })}
                  >
                    Edit
                  </button>
                </div>
                <dl className="savings-goal-figures">
                  <div>
                    <dt>Amount saved</dt>
                    <dd>{formatNzd(goal.currentAmountNzd)}</dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>{formatNzd(goal.targetNzd)}</dd>
                  </div>
                </dl>
                {moneyHidden ? null : (
                  <div
                    className="savings-goal-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(fill)}
                    aria-label={`${goal.name} progress`}
                  >
                    <div className="savings-goal-bar-fill" style={{ width: `${fill}%` }} />
                  </div>
                )}
                {goal.amountSource === 'account' && goal.accountName ? (
                  <p className="savings-goal-meta">Saving in {goal.accountName}</p>
                ) : null}
                {deadlineLine(goal) ? <p className="savings-goal-meta">{deadlineLine(goal)}</p> : null}
                {goal.notes ? <p className="savings-goal-meta savings-goal-notes">{goal.notes}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

    </section>
  );

  return (
    <>
      {card}
      {dialog ? (
        <SavingsGoalDialog
          key={dialog.mode === 'add' ? 'add' : dialog.goal.id}
          mode={dialog.mode}
          goal={dialog.mode === 'edit' ? dialog.goal : null}
          onClose={closeDialog}
          onSaved={refresh}
        />
      ) : null}
    </>
  );
}

function SavingsGoalDialog({
  mode,
  goal,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit';
  goal: SavingsGoal | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? String(goal.targetNzd) : '');
  const [saved, setSaved] = useState(goal ? String(goal.currentAmountNzd) : '');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [notes, setNotes] = useState(goal?.notes ?? '');
  const [accountId, setAccountId] = useState(goal?.accountId ?? '');
  const [accounts, setAccounts] = useState<GoalAccount[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadGoalAccounts()
      .then((list) => {
        if (!cancelled) setAccounts(list);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function dismiss() {
    if (busy) return;
    onClose();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Enter a name.');
      return;
    }
    const targetNzd = parsePositiveNzd(target);
    if (targetNzd == null) {
      setFormError('Target must be greater than 0.');
      return;
    }
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      setFormError('Pick a deadline date, or leave it blank.');
      return;
    }
    if (notes.trim().length > NOTES_MAX) {
      setFormError(`Notes must be ${NOTES_MAX} characters or fewer.`);
      return;
    }
    let currentAmountNzd = 0;
    if (mode === 'edit' && !accountId) {
      const parsedSaved = parseSavedNzd(saved);
      if (parsedSaved == null) {
        setFormError('Amount saved must be 0 or more.');
        return;
      }
      currentAmountNzd = parsedSaved;
    }

    setFormError(null);
    setSaving(true);
    try {
      const shared = {
        deadline: deadline || null,
        notes: notes.trim() || null,
        accountId: accountId || null,
      };
      if (mode === 'add') {
        await api.savingsGoals.create({ name: trimmed, targetNzd, ...shared });
      } else if (goal) {
        await api.savingsGoals.update(goal.id, {
          name: trimmed,
          targetNzd,
          // Linked goals take the account balance; keep the typed amount untouched underneath.
          ...(accountId ? {} : { currentAmountNzd }),
          ...shared,
        });
      }
    } catch (err) {
      if (!isUnauthorized(err)) {
        setFormError(goalsErrorMessage(err, 'Could not save this goal.'));
      }
      setSaving(false);
      return;
    }
    setSaving(false);
    onClose();
    invalidateFinancial('savings');
    await onSaved();
  }

  async function onDelete() {
    if (!goal || busy) return;
    if (!window.confirm(`Delete this goal?\n\n${goal.name}`)) return;
    setFormError(null);
    setDeleting(true);
    try {
      await api.savingsGoals.remove(goal.id);
    } catch (err) {
      if (!isUnauthorized(err)) {
        setFormError(goalsErrorMessage(err, 'Could not delete this goal.'));
      }
      setDeleting(false);
      return;
    }
    setDeleting(false);
    onClose();
    invalidateFinancial('savings');
    await onSaved();
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        className="modal-dialog savings-goal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <h3 id={titleId}>{mode === 'add' ? 'Add goal' : 'Edit goal'}</h3>
          <button
            type="button"
            className="btn small modal-close"
            aria-label="Close"
            disabled={busy}
            onClick={dismiss}
          >
            ×
          </button>
        </div>
        <form className="savings-goal-form" onSubmit={onSubmit}>
          <label>
            Name
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            Target
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Savings account
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={busy || accounts == null}>
              <option value="">None — I&apos;ll enter the amount saved</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
              {goal?.accountId && accounts && !accounts.some((a) => a.id === goal.accountId) ? (
                <option value={goal.accountId}>{goal.accountName ?? 'Current account'}</option>
              ) : null}
            </select>
            <span className="savings-goal-hint">
              {accountId
                ? 'Amount saved follows this account’s balance and updates with each bank sync.'
                : 'Pick the account this money is kept in to track it automatically.'}
            </span>
          </label>
          {mode === 'edit' && !accountId ? (
            <label>
              Amount saved
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={saved}
                onChange={(event) => setSaved(event.target.value)}
                disabled={busy}
              />
            </label>
          ) : null}
          <label>
            Deadline (optional)
            <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} disabled={busy} />
          </label>
          <label>
            Notes (optional)
            <textarea
              rows={3}
              maxLength={NOTES_MAX}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={busy}
            />
          </label>
          {formError ? (
            <p className="savings-goal-form-error" role="alert">{formError}</p>
          ) : null}
          <div className="savings-goal-form-actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={dismiss}>
              Cancel
            </button>
          </div>
          {mode === 'edit' ? (
            <div className="savings-goal-form-actions">
              <button type="button" className="btn danger" disabled={busy} onClick={() => void onDelete()}>
                {deleting ? 'Deleting…' : 'Delete goal'}
              </button>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
