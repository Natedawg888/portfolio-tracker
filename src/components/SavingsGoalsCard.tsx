import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api, formatNzd } from '../api/client';
import type { SavingsGoal } from '../types';

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

export function SavingsGoalsCard() {
  const [goals, setGoals] = useState<SavingsGoal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await api.savingsGoals.list();
      setGoals(rows);
      setError(null);
    } catch (err) {
      if (isUnauthorized(err)) return;
      setGoals(null);
      setError(goalsErrorMessage(err, 'Could not load savings goals.'));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.savingsGoals
      .list()
      .then((rows) => {
        if (cancelled) return;
        setGoals(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || isUnauthorized(err)) return;
        setGoals(null);
        setError(goalsErrorMessage(err, 'Could not load savings goals.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;

  useEffect(() => {
    nameRef.current?.focus();
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
    let currentAmountNzd = 0;
    if (mode === 'edit') {
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
      if (mode === 'add') {
        await api.savingsGoals.create({ name: trimmed, targetNzd });
      } else if (goal) {
        await api.savingsGoals.update(goal.id, {
          name: trimmed,
          targetNzd,
          currentAmountNzd,
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
          {mode === 'edit' ? (
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
