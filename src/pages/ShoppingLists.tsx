/**
 * Shopping lists (KAN-74). Reached from the Budget page. Lists and items are the user's own;
 * the store comparison uses only prices KoruLedger users recorded and chose to share
 * (no scraping, nothing estimated). Amounts follow Hide amounts through formatNzd.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import type {
  BudgetCategory,
  ShoppingCompareResponse,
  ShoppingListDetail,
  ShoppingListSummary,
  ShoppingPrefs,
  ShoppingStore,
} from '../types';
import { useMoneyHidden } from '../lib/privacy';
import { showQuietToast } from '../lib/quietToast';
import { readListStore, storeKey as storeKeyOf, storeLabel, writeListStore } from '../lib/shoppingView';
import { ListHeader } from '../components/shopping/ListHeader';
import { BudgetCard } from '../components/shopping/BudgetCard';
import { AddItemRow, ItemsList } from '../components/shopping/Items';
import { CompareStores, PriceNote } from '../components/shopping/Prices';
import { aucklandToday } from '../lib/debtModel';

type Prefs = ShoppingPrefs & { sharedCount: number; chains: { id: string; label: string }[] };

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const storeKey = (s: ShoppingStore) => `${s.chain}|${s.branch.toLowerCase().replace(/\s+/g, ' ').trim()}`;

function CategorySelect({ value, categories, onChange, label }: { value: string | null; categories: BudgetCategory[]; onChange: (v: string | null) => void; label: string }) {
  return (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No budget category</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function ListsOverview({ lists, categories, onOpen, onCreated }: { lists: ShoppingListSummary[]; categories: BudgetCategory[]; onOpen: (id: string) => void; onCreated: (l: ShoppingListDetail) => void }) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.shopping.createList({ name, categoryId }));
      setName('');
    } catch (err) {
      setError(errText(err, 'Could not create the list.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel shop-overview" aria-labelledby="shop-lists-title">
      <h3 id="shop-lists-title">Your lists</h3>
      {lists.length === 0 ? <p className="muted small">No lists yet. Start one below, for example your weekly groceries.</p> : null}
      <ul className="shop-list-cards">
        {lists.map((l) => (
          <li key={l.id}>
            <button type="button" className="shop-list-card" onClick={() => onOpen(l.id)}>
              <span className="shop-list-card-name">{l.name}</span>
              <span className="muted small">
                {l.itemCount} item{l.itemCount === 1 ? '' : 's'}
                {l.tickedCount ? ` · ${l.tickedCount} ticked` : ''} · about {formatNzd(l.estimatedTotalNzd)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <form className="shop-new-list" onSubmit={(e) => void create(e)}>
        <label htmlFor={nameId}>New list</label>
        <div className="shop-row">
          <input id={nameId} value={name} maxLength={60} placeholder="e.g. Weekly groceries" onChange={(e) => setName(e.target.value)} />
          <CategorySelect label="Budget category for the new list" value={categoryId} categories={categories} onChange={setCategoryId} />
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            Create list
          </button>
        </div>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}

function StoresAndSharing({
  prefs,
  onSaved,
  panelRef,
  onClose,
}: {
  prefs: Prefs;
  onSaved: (p: Prefs, note: string) => void;
  panelRef?: React.Ref<HTMLElement>;
  /** Set when shown as a panel on a list; closes it. */
  onClose?: () => void;
}) {
  const [chain, setChain] = useState(prefs.chains[0]?.id ?? 'woolworths');
  const [branch, setBranch] = useState('');
  const [suggest, setSuggest] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      api.shopping
        .branches(chain, branch)
        .then((r) => !cancelled && setSuggest(r))
        .catch(() => !cancelled && setSuggest([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [chain, branch]);

  async function save(patch: Parameters<typeof api.shopping.savePrefs>[0], note: string) {
    setError(null);
    try {
      onSaved(await api.shopping.savePrefs(patch), note);
    } catch (e) {
      setError(errText(e, 'Could not save.'));
    }
  }

  return (
    <section
      ref={panelRef}
      className={'panel shop-settings' + (onClose ? ' is-panel' : '')}
      aria-labelledby="shop-settings-title"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (onClose && e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="shop-settings-head">
        <h3 id="shop-settings-title">Stores and price sharing</h3>
        {onClose ? (
          <button type="button" className="btn shop-settings-done" onClick={onClose}>
            Done
          </button>
        ) : null}
      </div>
      <ul className="shop-store-chips">
        {prefs.stores.map((s) => (
          <li key={storeKey(s)}>
            {storeLabel(s)}{' '}
            <button
              type="button"
              className="shop-chip-remove"
              aria-label={`Remove ${storeLabel(s)}`}
              onClick={() => void save({ stores: prefs.stores.filter((x) => storeKey(x) !== storeKey(s)) }, 'Store removed.')}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        className="shop-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!branch.trim()) return;
          void save({ stores: [...prefs.stores, { chain: chain as ShoppingStore['chain'], branch }] }, 'Store added.').then(() => setBranch(''));
        }}
      >
        <select aria-label="Supermarket" value={chain} onChange={(e) => setChain(e.target.value)}>
          {prefs.chains.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <input aria-label="Branch" list={listId} value={branch} maxLength={60} placeholder="Branch, e.g. Royal Oak" onChange={(e) => setBranch(e.target.value)} />
        <datalist id={listId}>
          {suggest.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <button type="submit" className="btn" disabled={!branch.trim() || prefs.stores.length >= 10}>
          Add store
        </button>
      </form>
      <label className="inline-check shop-share">
        <input type="checkbox" checked={prefs.contributePrices} onChange={(e) => void save({ contributePrices: e.target.checked }, e.target.checked ? 'Thanks for sharing prices.' : 'Price sharing is off.')} />
        Share prices I record, anonymously, to help others compare
      </label>
      <p className="muted small">
        Shared: the item name, store, price and date, with no link to your account that others can see. Your lists stay private.{' '}
        <Link to="/privacy#collect">Privacy policy</Link>
      </p>
      <label className="shop-window">
        Use prices from the last
        <select value={prefs.windowDays} onChange={(e) => void save({ windowDays: Number(e.target.value) }, 'Saved.')}>
          {[30, 60, 90].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </label>
      {prefs.sharedCount > 0 ? (
        <button
          type="button"
          className="btn small ghost"
          onClick={() => {
            if (!window.confirm(`Remove the ${prefs.sharedCount} prices you have shared?`)) return;
            void api.shopping
              .removeMyPrices()
              .then(() => api.shopping.prefs())
              .then((p) => onSaved(p, 'Your shared prices were removed.'))
              .catch((e: unknown) => setError(errText(e, 'Could not remove them.')));
          }}
        >
          Remove the {prefs.sharedCount} prices I’ve shared
        </button>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function ShoppingLists() {
  // Re-render when Hide amounts changes; formatNzd then masks every figure.
  useMoneyHidden();
  const [params, setParams] = useSearchParams();
  const openId = params.get('list');
  const [lists, setLists] = useState<ShoppingListSummary[] | null>(null);
  const [list, setList] = useState<ShoppingListDetail | null>(null);
  const [compare, setCompare] = useState<ShoppingCompareResponse | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [storesOpen, setStoresOpen] = useState(false);
  const [storeChoice, setStoreChoice] = useState<Record<string, string>>({});
  const [categoryRequest, setCategoryRequest] = useState(0);
  // Option (b): prices typed at a store stay private until shared. Kept on this page only.
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const storesRef = useRef<HTMLElement>(null);
  const toast = (note: string) => showQuietToast(note, { kind: 'info', ttlMs: 4000 });
  const [today] = useState(() => aucklandToday());
  const spending = useMemo(() => categories.filter((c) => c.type === 'spending'), [categories]);

  const loadLists = useCallback(() => {
    api.shopping.lists().then(setLists).catch((e: unknown) => setError(errText(e, 'Could not load your lists.')));
  }, []);

  useEffect(() => {
    loadLists();
    api.shopping.prefs().then(setPrefs).catch(() => {});
    api.budgets.categories().then((c) => setCategories(c as BudgetCategory[])).catch(() => {});
  }, [loadLists]);

  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    api.shopping
      .list(openId)
      .then((l) => !cancelled && setList(l))
      .catch((e: unknown) => !cancelled && setError(errText(e, 'Could not open the list.')));
    return () => {
      cancelled = true;
    };
  }, [openId]);

  const shown = openId && list?.id === openId ? list : null;
  const listKey = shown ? `${shown.id}:${shown.updatedAt}:${prefs?.windowDays}:${prefs?.stores.length}` : '';
  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    api.shopping.compare(shown.id).then((c) => !cancelled && setCompare(c)).catch(() => !cancelled && setCompare(null));
    return () => {
      cancelled = true;
    };
    // listKey covers the list and the settings the comparison depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  const open = (id: string | null) => {
    setError(null);
    setStoresOpen(false);
    setCompare(null);
    setParams(id ? { list: id } : {});
  };

  async function act(fn: () => Promise<ShoppingListDetail | null>, note?: string) {
    setBusy(true);
    setError(null);
    try {
      const l = await fn();
      if (l) setList(l);
      if (note) toast(note);
      loadLists();
    } catch (e) {
      setError(errText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  /** The store chosen for this list (remembered per list in this browser), else the first. */
  const store = useMemo(() => {
    if (!shown || !prefs) return null;
    const key = storeChoice[shown.id];
    return (key ? prefs.stores.find((s) => storeKeyOf(s) === key) : undefined) ?? readListStore(shown.id, prefs.stores);
  }, [shown, prefs, storeChoice]);

  /** Items priced at the chosen store since the last share that still have a price. */
  const pendingHere = useMemo(() => {
    if (!shown || !store) return [];
    const ids = new Set(pending[storeKeyOf(store)] ?? []);
    return shown.items.filter((i) => ids.has(i.id) && i.estPriceNzd != null && i.estPriceNzd > 0);
  }, [shown, store, pending]);

  async function shareTyped() {
    if (!shown || !store || pendingHere.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.shopping.recordPrices(shown.id, {
        chain: store.chain,
        branch: store.branch,
        prices: pendingHere.map((i) => ({ itemId: i.id, priceNzd: i.estPriceNzd as number })),
      });
      setList(r.list);
      setPending((p) => ({ ...p, [storeKeyOf(store)]: [] }));
      toast(
        r.shared > 0
          ? `Shared ${r.shared} price${r.shared === 1 ? '' : 's'} anonymously. Thank you.`
          : r.notShared > 0
            ? 'Not shared: the daily sharing limit is reached.'
            : 'Not shared: price sharing is off.',
      );
    } catch (e) {
      setError(errText(e, 'Could not share the prices.'));
    } finally {
      setBusy(false);
    }
  }

  const openStores = () => {
    setStoresOpen(true);
    window.requestAnimationFrame(() => {
      storesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      storesRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="stack bills-page warranties-page shopping-page">
      {shown ? (
        <ListHeader
          name={shown.name}
          categoryId={shown.categoryId}
          categories={spending}
          stores={prefs?.stores ?? []}
          store={store}
          busy={busy}
          categoryEditorRequest={categoryRequest}
          onBack={() => open(null)}
          onPickStore={(s) => {
            writeListStore(shown.id, s);
            setStoreChoice((c) => ({ ...c, [shown.id]: storeKeyOf(s) }));
          }}
          onAddStore={openStores}
          onOpenStores={openStores}
          onRename={async (name) => {
            await act(() => api.shopping.updateList(shown.id, { name }), 'List renamed.');
            return true;
          }}
          onCategory={async (categoryId) => {
            await act(() => api.shopping.updateList(shown.id, { categoryId }), 'Budget category updated.');
            return true;
          }}
          onUntickAll={() => void act(() => api.shopping.resetList(shown.id), 'Everything unticked, ready to shop again.')}
          onDelete={() => {
            if (!window.confirm(`Delete “${shown.name}” and its items?`)) return;
            void api.shopping.removeList(shown.id).then(() => {
              loadLists();
              open(null);
              toast('List deleted.');
            });
          }}
        />
      ) : (
        <header className="warranties-header">
          <div>
            <Link className="warranties-back" to="/spending">
              ‹ Budget
            </Link>
            <h2 className="page-title">Shopping lists</h2>
          </div>
        </header>
      )}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {prefs && shown && storesOpen ? (
        <StoresAndSharing
          panelRef={storesRef}
          prefs={prefs}
          onSaved={(p, note) => { setPrefs(p); toast(note); }}
          onClose={() => {
            setStoresOpen(false);
            window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.shop-head .txn-menu-toggle')?.focus());
          }}
        />
      ) : null}
      {!lists && !error ? <p className="muted">Loading…</p> : null}

      {!openId && lists ? (
        <ListsOverview lists={lists} categories={spending} onOpen={open} onCreated={(l) => { setList(l); loadLists(); open(l.id); }} />
      ) : null}

      {shown ? (
        <>
          <BudgetCard list={shown} onChangeCategory={() => setCategoryRequest((n) => n + 1)} />
          <section className="panel shop-detail" aria-label={`Items on ${shown.name}`}>
            <AddItemRow busy={busy} onAdd={(name, price) => act(() => api.shopping.addItem(shown.id, { name, estPriceNzd: price })).then(() => undefined)} />
            <ItemsList
              items={shown.items}
              categories={spending}
              store={store}
              storePrices={store && compare ? (compare.stores.find((c) => storeKeyOf({ chain: c.chain, branch: c.branch }) === storeKeyOf(store)) ?? null) : null}
              today={today}
              busy={busy}
              onChange={(i, patch) => void act(() => api.shopping.updateItem(i.id, patch))}
              onPriceTyped={(i, price) => {
                void act(() => api.shopping.updateItem(i.id, { estPriceNzd: price }));
                if (!store) return;
                const k = storeKeyOf(store);
                setPending((p) => {
                  const ids = (p[k] ?? []).filter((x) => x !== i.id);
                  return { ...p, [k]: price != null && price > 0 ? [...ids, i.id] : ids };
                });
              }}
              onDelete={(i) => void act(() => api.shopping.removeItem(i.id), `${i.name} removed.`)}
            />
            <PriceNote
              store={store}
              sharing={Boolean(prefs?.contributePrices)}
              pending={pendingHere.length}
              busy={busy}
              onOpenSettings={openStores}
              onShare={() => void shareTyped()}
            />
          </section>

          <section className="panel" aria-labelledby="shop-compare-title">
            <h3 id="shop-compare-title">Compare stores</h3>
            <CompareStores list={shown} data={compare} onAddStore={openStores} />
          </section>
        </>
      ) : null}

      {prefs && !shown ? <StoresAndSharing prefs={prefs} onSaved={(p, note) => { setPrefs(p); toast(note); }} /> : null}
    </div>
  );
}
