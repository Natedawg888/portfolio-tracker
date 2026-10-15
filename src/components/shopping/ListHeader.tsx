/**
 * Shopping list header: "‹ All lists", the list name, a "Shopping at [store] ▾" pill, and a
 * ⋯ menu (Rename, Budget category, Untick all, Stores & price sharing, Delete). Rename and
 * category open small inline editors under the header.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { MoreMenu } from '../MoreMenu';
import type { BudgetCategory, ShoppingStore } from '../../types';
import { storeKey, storeLabel } from '../../lib/shoppingView';

type Editor = 'rename' | 'category' | null;

export function ListHeader({
  name,
  categoryId,
  categories,
  stores,
  store,
  busy,
  onBack,
  onPickStore,
  onAddStore,
  onRename,
  onCategory,
  onUntickAll,
  onOpenStores,
  onDelete,
  categoryEditorRequest,
}: {
  name: string;
  categoryId: string | null;
  categories: BudgetCategory[];
  stores: ShoppingStore[];
  store: ShoppingStore | null;
  busy: boolean;
  onBack: () => void;
  onPickStore: (s: ShoppingStore) => void;
  onAddStore: () => void;
  onRename: (name: string) => Promise<boolean>;
  onCategory: (id: string | null) => Promise<boolean>;
  onUntickAll: () => void;
  onOpenStores: () => void;
  onDelete: () => void;
  /** Bumped by the budget card to open the category editor. */
  categoryEditorRequest: number;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [draftName, setDraftName] = useState(name);
  const [draftCategory, setDraftCategory] = useState(categoryId ?? '');
  const ids = { picker: useId(), name: useId(), category: useId() };
  const pillRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLFormElement>(null);

  // The budget card's "change" opens the category editor here.
  const lastRequest = useRef(categoryEditorRequest);
  useEffect(() => {
    if (categoryEditorRequest === lastRequest.current) return;
    lastRequest.current = categoryEditorRequest;
    setDraftCategory(categoryId ?? '');
    setEditor('category');
  }, [categoryEditorRequest, categoryId]);

  useEffect(() => {
    if (editor) editorRef.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, [editor]);

  const openEditor = (e: Editor) => {
    setDraftName(name);
    setDraftCategory(categoryId ?? '');
    setEditor(e);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = editor === 'rename' ? await onRename(draftName) : await onCategory(draftCategory || null);
    if (ok) setEditor(null);
  }

  return (
    <header className="shop-head">
      <button type="button" className="link-btn shop-back" onClick={onBack}>
        ‹ All lists
      </button>
      <div className="shop-head-row">
        <h2 className="page-title shop-title">{name}</h2>
        <MoreMenu menu label={`More actions for ${name}`}>
          {(close) => (
            <>
              <button type="button" role="menuitem" tabIndex={-1} className="btn small shop-menu-item" onClick={() => { close(); openEditor('rename'); }}>
                Rename
              </button>
              <button type="button" role="menuitem" tabIndex={-1} className="btn small shop-menu-item" onClick={() => { close(); openEditor('category'); }}>
                Budget category
              </button>
              <button type="button" role="menuitem" tabIndex={-1} className="btn small shop-menu-item" disabled={busy} onClick={() => { close(); onUntickAll(); }}>
                Untick all
              </button>
              <button type="button" role="menuitem" tabIndex={-1} className="btn small shop-menu-item" onClick={() => { close(); onOpenStores(); }}>
                Stores & price sharing
              </button>
              <button type="button" role="menuitem" tabIndex={-1} className="btn small shop-menu-item danger" disabled={busy} onClick={() => { close(); onDelete(); }}>
                Delete list
              </button>
            </>
          )}
        </MoreMenu>
      </div>

      <button
        ref={pillRef}
        type="button"
        className="shop-store-pill"
        aria-expanded={pickerOpen}
        aria-controls={ids.picker}
        onClick={() => (stores.length === 0 ? onAddStore() : setPickerOpen((o) => !o))}
      >
        {store ? (
          <>
            Shopping at <strong>{storeLabel(store)}</strong>
          </>
        ) : (
          'Choose where you’re shopping'
        )}
        <span aria-hidden="true"> ▾</span>
      </button>
      {pickerOpen ? (
        <div id={ids.picker} className="shop-store-options" role="group" aria-label="Choose a store">
          {stores.map((s) => {
            const on = store != null && storeKey(s) === storeKey(store);
            return (
              <button
                key={storeKey(s)}
                type="button"
                className={'shop-store-option' + (on ? ' is-on' : '')}
                aria-pressed={on}
                onClick={() => {
                  onPickStore(s);
                  setPickerOpen(false);
                  pillRef.current?.focus();
                }}
              >
                {storeLabel(s)}
              </button>
            );
          })}
          <button
            type="button"
            className="shop-store-option shop-store-add"
            onClick={() => {
              setPickerOpen(false);
              onAddStore();
            }}
          >
            + Add store
          </button>
        </div>
      ) : null}

      {editor ? (
        <form ref={editorRef} className="shop-head-editor" onSubmit={(e) => void submit(e)}>
          {editor === 'rename' ? (
            <>
              <label htmlFor={ids.name}>List name</label>
              <input id={ids.name} value={draftName} maxLength={60} onChange={(e) => setDraftName(e.target.value)} />
            </>
          ) : (
            <>
              <label htmlFor={ids.category}>Budget category for this list</label>
              <select id={ids.category} value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
                <option value="">No budget category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="shop-head-editor-actions">
            <button type="submit" className="btn primary" disabled={busy || (editor === 'rename' && !draftName.trim())}>
              Save
            </button>
            <button type="button" className="btn ghost" onClick={() => setEditor(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </header>
  );
}
