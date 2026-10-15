/**
 * Shopping lists (KAN-74). Reached from the Budget page. Lists and items are the user's own;
 * the store comparison uses only prices KoruLedger users recorded and chose to share
 * (no scraping, nothing estimated). Amounts follow Hide amounts through formatNzd.
 */
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import type {
  BudgetCategory,
  ShoppingCompareResponse,
  ShoppingItem,
  ShoppingListDetail,
  ShoppingListSummary,
  ShoppingPrefs,
  ShoppingStore,
} from '../types';
import { longDate } from './warrantiesView';
import { useMoneyHidden } from '../lib/privacy';

type Prefs = ShoppingPrefs & { sharedCount: number; chains: { id: string; label: string }[] };

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/, ''));
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

function MatchPicker({ item, onPick }: { item: ShoppingItem; onPick: (key: string | null) => void }) {
  const [q, setQ] = useState(item.name);
  const [rows, setRows] = useState<{ key: string; name: string }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      api.shopping
        .products(q)
        .then((r) => !cancelled && setRows(r))
        .catch(() => !cancelled && setRows([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="shop-match">
      <input type="search" aria-label={`Find the product for ${item.name}`} value={q} onChange={(e) => setQ(e.target.value)} />
      {rows && rows.length === 0 ? <p className="muted small">No shared products match yet.</p> : null}
      <ul>
        {(rows ?? []).map((r) => (
          <li key={r.key}>
            <button type="button" className="link-btn" onClick={() => onPick(r.key)}>
              {r.name}
            </button>
          </li>
        ))}
      </ul>
      {item.matchCorrected ? (
        <button type="button" className="link-btn" onClick={() => onPick(null)}>
          Match by my item’s name again
        </button>
      ) : null}
    </div>
  );
}

function ItemRow({ item, categories, busy, onChange, onDelete }: {
  item: ShoppingItem;
  categories: BudgetCategory[];
  busy: boolean;
  onChange: (patch: Parameters<typeof api.shopping.updateItem>[1]) => void;
  onDelete: () => void;
}) {
  const [qty, setQty] = useState(qtyText(item.quantity));
  const [price, setPrice] = useState(item.estPriceNzd == null ? '' : String(item.estPriceNzd));
  const [matching, setMatching] = useState(false);
  const commitQty = () => {
    const n = Number(qty);
    if (Number.isFinite(n) && n > 0 && n !== item.quantity) onChange({ quantity: n });
    else setQty(qtyText(item.quantity));
  };
  const commitPrice = () => {
    const next = price.trim() === '' ? null : Number(price);
    if (next === item.estPriceNzd) return;
    if (next === null || (Number.isFinite(next) && next >= 0)) onChange({ estPriceNzd: next });
    else setPrice(item.estPriceNzd == null ? '' : String(item.estPriceNzd));
  };
  return (
    <li className={'shop-item' + (item.ticked ? ' is-ticked' : '')}>
      <label className="shop-tick">
        <input type="checkbox" checked={item.ticked} disabled={busy} onChange={(e) => onChange({ ticked: e.target.checked })} />
        <span className="shop-item-name">{item.name}</span>
      </label>
      <div className="shop-item-fields">
        <label>
          <span className="sr-only">Quantity of {item.name}</span>
          <input className="shop-qty" type="number" min={0.01} step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onBlur={commitQty} />
        </label>
        <label>
          <span className="sr-only">Price each for {item.name} (NZD)</span>
          <input className="shop-price" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={commitPrice} />
        </label>
        <span className="shop-line-total">{item.lineTotalNzd == null ? '—' : formatNzd(item.lineTotalNzd)}</span>
      </div>
      <div className="shop-item-more">
        <CategorySelect label={`Budget category for ${item.name}`} value={item.categoryId} categories={categories} onChange={(v) => onChange({ categoryId: v })} />
        <button type="button" className="link-btn" aria-expanded={matching} onClick={() => setMatching((m) => !m)}>
          {item.matchCorrected ? 'Price match corrected' : 'Fix price match'}
        </button>
        <button type="button" className="link-btn" disabled={busy} onClick={onDelete}>
          Remove
        </button>
      </div>
      {matching ? (
        <MatchPicker
          item={item}
          onPick={(key) => {
            setMatching(false);
            onChange({ productKey: key });
          }}
        />
      ) : null}
    </li>
  );
}

function RecordPrices({ list, prefs, onSaved }: { list: ShoppingListDetail; prefs: Prefs; onSaved: (l: ShoppingListDetail, note: string) => void }) {
  const [store, setStore] = useState(prefs.stores[0] ? storeKey(prefs.stores[0]) : '');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = prefs.stores.find((s) => storeKey(s) === store);
  const entries = list.items
    .map((i) => ({ itemId: i.id, priceNzd: Number(prices[i.id]) }))
    .filter((e) => prices[e.itemId]?.trim() && Number.isFinite(e.priceNzd) && e.priceNzd > 0);

  if (prefs.stores.length === 0) {
    return <p className="muted small">Add the stores you shop at under “Stores and price sharing” to record prices.</p>;
  }

  async function save() {
    if (!chosen || entries.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.shopping.recordPrices(list.id, { chain: chosen.chain, branch: chosen.branch, prices: entries });
      setPrices({});
      onSaved(
        r.list,
        r.shared > 0
          ? `Saved ${entries.length} price${entries.length === 1 ? '' : 's'} and shared ${r.shared} anonymously. Thank you.`
          : `Saved ${entries.length} price${entries.length === 1 ? '' : 's'} to your list${prefs.contributePrices ? ' (daily sharing limit reached)' : ''}.`,
      );
    } catch (e) {
      setError(errText(e, 'Could not save the prices.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shop-record">
      <label>
        Shopping at
        <select value={store} onChange={(e) => setStore(e.target.value)}>
          {prefs.stores.map((s) => (
            <option key={storeKey(s)} value={storeKey(s)}>
              {prefs.chains.find((c) => c.id === s.chain)?.label ?? s.chain} {s.branch}
            </option>
          ))}
        </select>
      </label>
      <ul className="shop-record-rows">
        {list.items.map((i) => (
          <li key={i.id}>
            <span>{i.name}</span>
            <input
              type="number"
              min={0.01}
              step="0.01"
              inputMode="decimal"
              aria-label={`Price paid each for ${i.name} (NZD)`}
              placeholder="Price each"
              value={prices[i.id] ?? ''}
              onChange={(e) => setPrices((p) => ({ ...p, [i.id]: e.target.value }))}
            />
          </li>
        ))}
      </ul>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap">
        <button type="button" className="btn primary" disabled={busy || entries.length === 0} onClick={() => void save()}>
          Save prices
        </button>
        <span className="muted small">
          {prefs.contributePrices ? 'Prices are also shared anonymously to help others compare.' : 'Saved to your list only. Sharing is off.'}
        </span>
      </div>
    </div>
  );
}

function Comparison({ list, data }: { list: ShoppingListDetail; data: ShoppingCompareResponse }) {
  if (data.stores.length === 0) return <p className="muted small">Add the stores you shop at to compare prices.</p>;
  const cheapest = data.cheapest ? data.stores.find((s) => s.chain === data.cheapest!.chain && s.branch === data.cheapest!.branch) : null;
  return (
    <div className="shop-compare">
      <p className="shop-compare-verdict" aria-live="polite">
        {cheapest
          ? `${cheapest.chainLabel} ${cheapest.branch} looks cheapest: ${formatNzd(cheapest.total)} for the ${cheapest.pricedCount} of ${data.itemCount} items with a recent price.`
          : 'No recent shared prices for these items at your stores yet.'}
        {data.split && data.split.savingVsCheapest != null && data.split.savingVsCheapest > 0.004
          ? ` Splitting the shop would save about ${formatNzd(data.split.savingVsCheapest)}.`
          : ''}
      </p>
      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table className="data-table shop-compare-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              {data.stores.map((s) => (
                <th key={`${s.chain}|${s.branch}`} scope="col" style={{ textAlign: 'right' }}>
                  {s.chainLabel}
                  <br />
                  <span className="muted small">{s.branch}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.items.map((i) => (
              <tr key={i.id}>
                <th scope="row">
                  {i.name}
                  {i.quantity !== 1 ? <span className="muted small"> × {qtyText(i.quantity)}</span> : null}
                </th>
                {data.stores.map((s) => {
                  const cell = s.items[i.id];
                  return (
                    <td key={`${s.chain}|${s.branch}`} className="money" style={{ textAlign: 'right' }}>
                      {cell ? (
                        <>
                          {formatNzd(cell.lineTotal)}
                          <br />
                          <span className="muted small">{longDate(cell.observedOn)}</span>
                        </>
                      ) : (
                        <span aria-label="No recent price">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total (items priced)</th>
              {data.stores.map((s) => (
                <td key={`${s.chain}|${s.branch}`} className="money" style={{ textAlign: 'right' }}>
                  {s.pricedCount ? formatNzd(s.total) : '—'}
                  <br />
                  <span className="muted small">
                    {s.pricedCount} of {data.itemCount} priced
                  </span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">
        Prices from the last {data.windowDays} days, recorded by KoruLedger users. Informational only: prices change in store, and
        totals only cover items with a recent price.
      </p>
    </div>
  );
}

function StoresAndSharing({ prefs, onSaved }: { prefs: Prefs; onSaved: (p: Prefs, note: string) => void }) {
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
    <section className="panel shop-settings" aria-labelledby="shop-settings-title">
      <h3 id="shop-settings-title">Stores and price sharing</h3>
      <ul className="shop-store-chips">
        {prefs.stores.map((s) => (
          <li key={storeKey(s)}>
            {prefs.chains.find((c) => c.id === s.chain)?.label} {s.branch}{' '}
            <button
              type="button"
              className="link-btn"
              aria-label={`Remove ${s.branch}`}
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
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', quantity: '1', price: '' });
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
    setMsg(null);
    setError(null);
    setCompare(null);
    setParams(id ? { list: id } : {});
  };

  async function act(fn: () => Promise<ShoppingListDetail | null>, note?: string) {
    setBusy(true);
    setError(null);
    try {
      const l = await fn();
      if (l) setList(l);
      if (note) setMsg(note);
      loadLists();
    } catch (e) {
      setError(errText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    if (!shown || !newItem.name.trim()) return;
    await act(() =>
      api.shopping.addItem(shown.id, {
        name: newItem.name,
        quantity: Number(newItem.quantity) > 0 ? Number(newItem.quantity) : 1,
        estPriceNzd: newItem.price.trim() === '' ? null : Number(newItem.price),
      }),
    );
    setNewItem({ name: '', quantity: '1', price: '' });
  }

  return (
    <div className="stack bills-page warranties-page shopping-page">
      <header className="warranties-header">
        <div>
          {shown ? (
            <button type="button" className="link-btn warranties-back" onClick={() => open(null)}>
              ‹ All lists
            </button>
          ) : (
            <Link className="warranties-back" to="/spending">
              ‹ Budget
            </Link>
          )}
          <h2 className="page-title">{shown ? shown.name : 'Shopping lists'}</h2>
        </div>
      </header>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {msg ? <p className="banner" role="status">{msg}</p> : null}
      {!lists && !error ? <p className="muted">Loading…</p> : null}

      {!openId && lists ? (
        <ListsOverview lists={lists} categories={spending} onOpen={open} onCreated={(l) => { setList(l); loadLists(); open(l.id); }} />
      ) : null}

      {shown ? (
        <>
          <section className="panel shop-detail" aria-label={shown.name}>
            <div className="shop-detail-head">
              <p className="shop-totals">
                About <strong>{formatNzd(shown.totals.estimatedNzd)}</strong> · still to buy {formatNzd(shown.totals.toBuyNzd)}
                {shown.totals.unpricedCount ? ` · ${shown.totals.unpricedCount} without a price` : ''}
              </p>
              <div className="row gap">
                <CategorySelect label="Budget category for this list" value={shown.categoryId} categories={spending} onChange={(v) => void act(() => api.shopping.updateList(shown.id, { categoryId: v }))} />
                <button type="button" className="btn small" disabled={busy} onClick={() => void act(() => api.shopping.resetList(shown.id), 'Everything unticked, ready to shop again.')}>
                  Untick all
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={busy}
                  onClick={() => {
                    const name = window.prompt('Rename list', shown.name);
                    if (name && name.trim() && name !== shown.name) void act(() => api.shopping.updateList(shown.id, { name }));
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Delete “${shown.name}” and its items?`)) return;
                    void api.shopping.removeList(shown.id).then(() => {
                      loadLists();
                      open(null);
                      setMsg('List deleted.');
                    });
                  }}
                >
                  Delete
                </button>
              </div>
            </div>

            {shown.budget.length > 0 ? (
              <ul className="shop-budget">
                {shown.budget.map((b) => (
                  <li key={b.categoryId} className={b.remainingNzd != null && b.toBuyNzd > b.remainingNzd ? 'is-over' : ''}>
                    <strong>{b.categoryName}</strong>: still to buy {formatNzd(b.toBuyNzd)}
                    {b.remainingNzd == null
                      ? ` · no plan this month (spent ${formatNzd(b.spentNzd)})`
                      : ` · ${formatNzd(b.remainingNzd)} left of ${formatNzd(b.plannedNzd)} this month${b.toBuyNzd > b.remainingNzd ? ', so this list goes over' : ''}`}
                  </li>
                ))}
              </ul>
            ) : null}

            <ul className="shop-items">
              {shown.items.map((i) => (
                <ItemRow
                  key={`${i.id}:${i.quantity}:${i.estPriceNzd}`}
                  item={i}
                  categories={spending}
                  busy={busy}
                  onChange={(patch) => void act(() => api.shopping.updateItem(i.id, patch))}
                  onDelete={() => void act(() => api.shopping.removeItem(i.id))}
                />
              ))}
            </ul>
            {shown.items.length === 0 ? <p className="muted small">No items yet.</p> : null}

            <form className="shop-row shop-add" onSubmit={(e) => void addItem(e)}>
              <input aria-label="Item" value={newItem.name} maxLength={80} placeholder="Add an item, e.g. Milk 2L" onChange={(e) => setNewItem((n) => ({ ...n, name: e.target.value }))} />
              <input aria-label="Quantity" className="shop-qty" type="number" min={0.01} step="any" inputMode="decimal" value={newItem.quantity} onChange={(e) => setNewItem((n) => ({ ...n, quantity: e.target.value }))} />
              <input aria-label="Price each (optional)" className="shop-price" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Price" value={newItem.price} onChange={(e) => setNewItem((n) => ({ ...n, price: e.target.value }))} />
              <button type="submit" className="btn primary" disabled={busy || !newItem.name.trim()}>
                Add
              </button>
            </form>
          </section>

          <section className="panel" aria-labelledby="shop-compare-title">
            <h3 id="shop-compare-title">Compare stores</h3>
            {compare ? <Comparison list={shown} data={compare} /> : <p className="muted small">Loading prices…</p>}
          </section>

          {prefs ? (
            <section className="panel" aria-labelledby="shop-record-title">
              <h3 id="shop-record-title">Record prices</h3>
              <RecordPrices key={shown.id} list={shown} prefs={prefs} onSaved={(l, note) => { setList(l); setMsg(note); loadLists(); }} />
            </section>
          ) : null}
        </>
      ) : null}

      {prefs ? <StoresAndSharing prefs={prefs} onSaved={(p, note) => { setPrefs(p); setMsg(note); }} /> : null}
    </div>
  );
}
