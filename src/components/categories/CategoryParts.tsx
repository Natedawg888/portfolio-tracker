/**
 * Pieces shared by Settings → Categories & assets (CategoryManager) and the onboarding
 * "Pick your budget categories" step: the type tabs and the add field. Rows use the same
 * .cat-row styles in both.
 */
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CATEGORY_TYPES, CATEGORY_TYPE_LABELS, type CategoryType } from '../../lib/categoryTypes';

/**
 * One tab per category type, with a count. Arrow keys, Home and End move between tabs
 * (roving tabindex). The panel is the caller's, with id `${idPrefix}-tab-panel`.
 */
export function CategoryTabs({
  tab,
  onSelect,
  counts,
  countLabel,
  idPrefix = 'cat',
}: {
  tab: CategoryType;
  onSelect: (t: CategoryType) => void;
  counts: Record<CategoryType, number>;
  /** Screen-reader words after the count, e.g. "selected". */
  countLabel?: string;
  idPrefix?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  function select(t: CategoryType, focus = false) {
    onSelect(t);
    if (focus) window.requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-type="${t}"]`)?.focus());
  }
  return (
    <div
      ref={ref}
      className="portfolio-tabs cat-tabs"
      role="tablist"
      aria-label="Category types"
      onKeyDown={(e) => {
        const i = CATEGORY_TYPES.indexOf(tab);
        const n = CATEGORY_TYPES.length;
        const next =
          e.key === 'ArrowRight' ? CATEGORY_TYPES[(i + 1) % n] : e.key === 'ArrowLeft' ? CATEGORY_TYPES[(i - 1 + n) % n] : e.key === 'Home' ? CATEGORY_TYPES[0] : e.key === 'End' ? CATEGORY_TYPES[n - 1] : null;
        if (!next) return;
        e.preventDefault();
        select(next, true);
      }}
    >
      {CATEGORY_TYPES.map((t) => (
        <button
          key={t}
          id={`${idPrefix}-tab-${t}`}
          data-type={t}
          type="button"
          role="tab"
          aria-selected={t === tab}
          aria-controls={`${idPrefix}-tab-panel`}
          tabIndex={t === tab ? 0 : -1}
          className={'portfolio-tab' + (t === tab ? ' active' : '')}
          onClick={() => select(t)}
        >
          {CATEGORY_TYPE_LABELS[t]}{' '}
          <span className="cat-tab-count">
            {counts[t]}
            {countLabel ? <span className="sr-only"> {countLabel}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The tab's panel, labelled by its tab. */
export function CategoryTabPanel({ tab, idPrefix = 'cat', children }: { tab: CategoryType; idPrefix?: string; children: ReactNode }) {
  return (
    <div id={`${idPrefix}-tab-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${tab}`}>
      {children}
    </div>
  );
}

/** "Add spending category" field and button. Enter adds. The field clears when onAdd returns true. */
export function CategoryAddField({ type, busy, onAdd }: { type: CategoryType; busy: boolean; onAdd: (name: string) => boolean | Promise<boolean> }) {
  const [name, setName] = useState('');
  const label = `Add ${CATEGORY_TYPE_LABELS[type].toLowerCase()} category`;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (await onAdd(n)) setName('');
  }
  return (
    <form className="cat-add" onSubmit={(e) => void submit(e)}>
      <input aria-label={label} placeholder={label} value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn small" disabled={busy || !name.trim()}>
        Add
      </button>
    </form>
  );
}
