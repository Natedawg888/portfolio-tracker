/**
 * Onboarding → Pick your budget categories. Same tabs, rows and add field as Settings →
 * Categories & assets, with a checkbox per category instead of Rename and ⋯.
 *
 * Starts from what is saved (the starter set is saved at signup); a starter category removed
 * earlier comes back unticked. Nothing is saved until Continue: unticked categories are deleted,
 * ticked missing ones are created, then the step is marked done. Until then the choices are kept
 * in this browser, so a refresh or signing in again shows them. Built-in categories are always
 * included, with the reason on hover, focus or tap.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../api/client';
import { CATEGORY_TYPE_LABELS, CATEGORY_TYPES, type CategoryType } from '../../lib/categoryTypes';
import { TYPE_EXPLAINER } from '../../lib/categoryManagerView';
import {
  addRow,
  buildRows,
  draftFromRows,
  isEmptyDraft,
  parseDraft,
  savePlan,
  tickedCount,
  toggleRow,
  withDefaults,
  type PickDraft,
  type PickRow,
  type SavedCategory,
} from '../../lib/onboardingCategories';
import { CategoryAddField, CategoryTabPanel, CategoryTabs } from '../categories/CategoryParts';
import { InfoTip } from '../InfoTip';

const draftKey = (userId: string) => `koru.onboarding.categories.${userId}`;

function readDraft(userId: string): PickDraft | null {
  try {
    return parseDraft(window.localStorage.getItem(draftKey(userId)));
  } catch {
    return null;
  }
}

function writeDraft(userId: string, draft: PickDraft | null): void {
  try {
    if (!draft || isEmptyDraft(draft)) window.localStorage.removeItem(draftKey(userId));
    else window.localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    /* Private mode or blocked storage: choices just aren't kept across a refresh. */
  }
}

function LockIcon() {
  return (
    <svg className="cat-lock" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export function BudgetCategoriesStep({ userId, onDone }: { userId: string; onDone: () => Promise<void> }) {
  const [saved, setSaved] = useState<SavedCategory[] | null>(null);
  const [rows, setRows] = useState<PickRow[]>([]);
  const [tab, setTab] = useState<CategoryType>('spending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    async (draft: PickDraft | null) => {
      const list = (await api.budgets.categories()) as SavedCategory[];
      // Anything the draft adds that now exists (a partly finished save) isn't added again.
      const exists = (a: { name: string; type: CategoryType }) => list.some((c) => c.type === a.type && c.name.toLowerCase() === a.name.toLowerCase());
      const ids = new Set(list.map((c) => `id:${c.id}`));
      const next = draft ? { unticked: draft.unticked.filter((k) => ids.has(k)), ticked: draft.ticked, added: draft.added.filter((a) => !exists(a)) } : null;
      setSaved(list);
      setRows(buildRows(list, next));
    },
    [],
  );

  useEffect(() => {
    load(readDraft(userId)).catch((err: unknown) => setError(errorText(err, 'Could not load your categories')));
  }, [load, userId]);

  function update(next: PickRow[]) {
    setRows(next);
    writeDraft(userId, draftFromRows(next));
  }

  const counts = useMemo(
    () => Object.fromEntries(CATEGORY_TYPES.map((t) => [t, tickedCount(rows, t)])) as Record<CategoryType, number>,
    [rows],
  );
  const total = tickedCount(rows);
  const shown = rows.filter((r) => r.type === tab);

  async function save(pick: PickRow[]) {
    setBusy(true);
    setError(null);
    setNote(null);
    const plan = savePlan(pick);
    try {
      for (const r of plan.remove) {
        try {
          await api.budgets.deleteCategory(r.id);
        } catch (err) {
          throw new Error(`Couldn’t remove “${r.name}”: ${errorText(err, 'please try again')}`);
        }
      }
      for (const c of plan.create) {
        try {
          await api.budgets.createCategory(c);
        } catch (err) {
          throw new Error(`Couldn’t add “${c.name}”: ${errorText(err, 'please try again')}`);
        }
      }
      writeDraft(userId, null);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your categories');
      // Show what is saved now, with the choices still to make on top.
      const draft = draftFromRows(pick);
      writeDraft(userId, draft);
      await load(draft).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (!saved) {
    return error ? (
      <p className="auth-error" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted">Loading your categories…</p>
    );
  }

  return (
    <div className="onboarding-cats">
      <CategoryTabs tab={tab} onSelect={(t) => { setTab(t); setNote(null); }} counts={counts} countLabel="selected" idPrefix="onb-cat" />
      <CategoryTabPanel tab={tab} idPrefix="onb-cat">
        <p className="muted small cat-explainer">{TYPE_EXPLAINER[tab]}</p>
        <ul className="cat-rows">
          {shown.map((r) => (
            <li key={r.key} className="cat-row-wrap">
              {r.locked ? (
                <div className="cat-row cat-pick is-locked">
                  <LockIcon />
                  <span className="cat-row-main">
                    <span className="cat-row-name">{r.name}</span>
                    <span className="cat-row-sub">
                      Always included{' '}
                      <InfoTip label={`Why ${r.name} is always included`}>{r.reason}</InfoTip>
                    </span>
                  </span>
                </div>
              ) : (
                <label className="cat-row cat-pick">
                  <input type="checkbox" checked={r.ticked} disabled={busy} onChange={() => update(toggleRow(rows, r.key))} />
                  <span className="cat-row-main">
                    <span className="cat-row-name">{r.name}</span>
                    {r.source === 'new' ? <span className="cat-row-sub">New</span> : null}
                  </span>
                </label>
              )}
            </li>
          ))}
          {shown.length === 0 ? <li className="muted small cat-empty">No {CATEGORY_TYPE_LABELS[tab].toLowerCase()} categories yet.</li> : null}
        </ul>
        <CategoryAddField
          key={tab}
          type={tab}
          busy={busy}
          onAdd={(name) => {
            const out = addRow(rows, tab, name);
            setNote(out.message);
            if (out.rows !== rows) update(out.rows);
            return out.message == null;
          }}
        />
        {note ? (
          <p className="muted small onboarding-cats-note" role="status">
            {note}
          </p>
        ) : null}
      </CategoryTabPanel>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="onboarding-cats-footer">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save(rows)}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
        <span className="muted small" aria-live="polite">
          {total} {total === 1 ? 'category' : 'categories'}
        </span>
        <button type="button" className="link-btn onboarding-cats-defaults" disabled={busy} onClick={() => void save(withDefaults(rows))}>
          Use the defaults
        </button>
      </div>
    </div>
  );
}
