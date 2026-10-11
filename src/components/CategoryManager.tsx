/**
 * Transaction categories: create, rename, recolour, change type, remove.
 * Used in Settings and in the Budget page's "Manage categories" dialog.
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import { beginPageRead, commitPageRead, invalidateFinancial, readPageCache } from '../lib/pageDataCache';
import {
  CATEGORY_TYPES,
  CATEGORY_TYPE_LABELS,
  normalizeCategoryType,
  type CategoryType,
} from '../lib/categoryTypes';
import { categoryColour, validColour } from '../lib/categoryColours';
import { CategoryTypeToggle } from './CategoryTypeToggle';

export type ManagedCategory = {
  id: string;
  name: string;
  parentId: string | null;
  colour: string | null;
  type: CategoryType;
  isIncome: boolean;
  sortOrder: number;
};

const CACHE_KEY = 'categories';

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function CategoryManager({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const [categories, setCategories] = useState<ManagedCategory[]>(
    () => readPageCache<ManagedCategory[]>(CACHE_KEY) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<CategoryType>('spending');
  const [editingId, setEditingId] = useState<string | null>(null);
  const newNameId = useId();

  const load = useCallback(async () => {
    const stamp = beginPageRead(CACHE_KEY);
    try {
      const rows = await api.budgets.categories();
      if (!commitPageRead(stamp, rows)) return;
      setCategories(rows);
    } catch (err) {
      setError(errorText(err, 'Could not load categories'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const afterChange = async (message: string) => {
    setMsg(message);
    invalidateFinancial('categories', 'spending', 'dashboard');
    await load();
    await onChanged?.();
  };

  async function run(action: () => Promise<string>, fallback: string): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await afterChange(await action());
      return true;
    } catch (err) {
      setError(errorText(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const type = newType;
    const ok = await run(async () => {
      await api.budgets.createCategory({ name, type });
      return `Added “${name}” (${CATEGORY_TYPE_LABELS[type].toLowerCase()}).`;
    }, 'Could not add category');
    if (ok) {
      setNewName('');
      setNewType('spending');
    }
  }

  async function onRemove(cat: ManagedCategory) {
    if (
      !window.confirm(
        `Remove category “${cat.name}”? Transactions keep their history but lose this category tag; related budget plans are deleted.`,
      )
    ) {
      return;
    }
    await run(async () => {
      await api.budgets.deleteCategory(cat.id);
      return `Removed “${cat.name}”.`;
    }, 'Could not remove category');
    setEditingId(null);
  }

  const byType = (t: CategoryType) => categories.filter((c) => normalizeCategoryType(c.type, c.isIncome) === t);

  return (
    <div className="category-manager">
      <form className="category-manager-add" onSubmit={onAdd}>
        <CategoryTypeToggle value={newType} onChange={setNewType} disabled={busy} label="Type for a new category" />
        <div className="row gap wrap-row category-manager-add-row">
          <label className="field grow" htmlFor={newNameId}>
            <span>New category name</span>
            <input
              id={newNameId}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Pets"
              disabled={busy}
              required
            />
          </label>
          <button type="submit" className="btn primary" disabled={busy || !newName.trim()}>
            {busy ? 'Saving…' : `Add ${CATEGORY_TYPE_LABELS[newType].toLowerCase()} category`}
          </button>
        </div>
      </form>

      {error ? (
        <p className="auth-error" role="alert">{error}</p>
      ) : null}
      {msg ? (
        <p className="auth-info" role="status">{msg}</p>
      ) : null}

      <div className="txn-cat-columns txn-cat-columns-4">
        {CATEGORY_TYPES.map((t) => {
          const rows = byType(t);
          return (
            <div key={t}>
              <h3>{CATEGORY_TYPE_LABELS[t]}</h3>
              <ul className="txn-cat-list category-manager-list">
                {rows.map((c) =>
                  editingId === c.id ? (
                    <li key={c.id} className="category-manager-editing">
                      <CategoryEditForm
                        category={c}
                        fallbackColour={categoryColour(null, 0)}
                        busy={busy}
                        onCancel={() => setEditingId(null)}
                        onRemove={() => void onRemove(c)}
                        onSave={async (patch) => {
                          const ok = await run(async () => {
                            await api.budgets.updateCategory(c.id, patch);
                            return `Saved “${patch.name}”.`;
                          }, 'Could not save category');
                          if (ok) setEditingId(null);
                        }}
                      />
                    </li>
                  ) : (
                    <li key={c.id}>
                      <span className="category-manager-name">
                        {validColour(c.colour) ? (
                          <span className="category-dot" style={{ background: validColour(c.colour)! }} aria-hidden="true" />
                        ) : (
                          <span className="category-dot category-dot--auto" aria-hidden="true" />
                        )}
                        {c.name}
                        {validColour(c.colour) ? null : <span className="muted small"> · auto colour</span>}
                      </span>
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={busy}
                        onClick={() => setEditingId(c.id)}
                        aria-label={`Edit ${c.name}`}
                      >
                        Edit
                      </button>
                    </li>
                  ),
                )}
                {rows.length === 0 ? (
                  <li className="muted">No {CATEGORY_TYPE_LABELS[t].toLowerCase()} categories.</li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CategoryEditForm({
  category,
  fallbackColour,
  busy,
  onSave,
  onCancel,
  onRemove,
}: {
  category: ManagedCategory;
  fallbackColour: string;
  busy: boolean;
  onSave: (patch: { name: string; type: CategoryType; colour: string | null }) => Promise<void>;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const ids = { name: useId(), type: useId(), colour: useId(), auto: useId() };
  const [name, setName] = useState(category.name);
  const [type, setType] = useState<CategoryType>(normalizeCategoryType(category.type, category.isIncome));
  const [colour, setColour] = useState(validColour(category.colour) ?? fallbackColour);
  const [auto, setAuto] = useState(validColour(category.colour) == null);
  const typeChanged = type !== normalizeCategoryType(category.type, category.isIncome);

  return (
    <form
      className="category-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void onSave({ name: name.trim(), type, colour: auto ? null : colour });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <label htmlFor={ids.name}>Name</label>
      <input
        id={ids.name}
        type="text"
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
        required
        autoFocus
      />
      <label htmlFor={ids.type}>Type</label>
      <select id={ids.type} value={type} onChange={(e) => setType(e.target.value as CategoryType)} disabled={busy}>
        {CATEGORY_TYPES.map((t) => (
          <option key={t} value={t}>
            {CATEGORY_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      {typeChanged ? (
        <p className="muted small" role="note">
          Existing transactions in this category will count as {CATEGORY_TYPE_LABELS[type].toLowerCase()} from now on.
          Only Spending counts toward budgets.
        </p>
      ) : null}
      <label htmlFor={ids.colour}>Colour</label>
      <div className="category-edit-colour">
        <input
          id={ids.colour}
          type="color"
          value={colour}
          onChange={(e) => {
            setColour(e.target.value);
            setAuto(false);
          }}
          disabled={busy}
        />
        <label className="inline-check" htmlFor={ids.auto}>
          <input id={ids.auto} type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={busy} />
          Automatic
        </label>
      </div>
      <div className="row gap category-edit-actions">
        <button type="submit" className="btn small primary" disabled={busy || !name.trim()}>
          Save
        </button>
        <button type="button" className="btn small ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn small danger" disabled={busy} onClick={onRemove}>
          Remove
        </button>
      </div>
    </form>
  );
}
