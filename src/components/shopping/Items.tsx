/**
 * Shopping list items: the add row (top), rows still to buy, and "In the trolley" for ticked
 * items. Each row: checkbox, name (tap to expand details), subline, − / + stepper, "$ each"
 * and the line total. A shared price for the chosen store is offered as a one-tap suggestion,
 * never filled in automatically. Prices are never invented: unknown shows "—".
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, formatNzd } from '../../api/client';
import type { BudgetCategory, ShoppingItem, ShoppingStore, ShoppingStoreComparison } from '../../types';
import { daysAgo, qtyText, stepQty, storeLabel } from '../../lib/shoppingView';

type Patch = Parameters<typeof api.shopping.updateItem>[1];

export function AddItemRow({ busy, onAdd }: { busy: boolean; onAdd: (name: string, price: number | null) => Promise<void> }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), price: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    const p = price.trim() === '' ? null : Number(price);
    await onAdd(name, p != null && Number.isFinite(p) && p >= 0 ? p : null);
    setName('');
    setPrice('');
    nameRef.current?.focus();
  }

  // Enter in either field submits the form (both are inside it).
  return (
    <form className="shop-add-row" onSubmit={(e) => void submit(e)}>
      <label htmlFor={ids.name} className="sr-only">
        Item to add
      </label>
      <input ref={nameRef} id={ids.name} value={name} maxLength={80} placeholder="Add an item" enterKeyHint="done" onChange={(e) => setName(e.target.value)} />
      <label htmlFor={ids.price} className="sr-only">
        Price each, optional (NZD)
      </label>
      <span className="shop-money-field">
        <span aria-hidden="true">$</span>
        <input id={ids.price} type="number" min={0} step="0.01" inputMode="decimal" placeholder="each" value={price} enterKeyHint="done" onChange={(e) => setPrice(e.target.value)} />
      </span>
      <button type="submit" className="btn primary" disabled={busy}>
        Add
      </button>
    </form>
  );
}

export function MatchPicker({ item, onPick }: { item: ShoppingItem; onPick: (key: string | null) => void }) {
  const [q, setQ] = useState(item.name);
  const [rows, setRows] = useState<{ key: string; name: string }[] | null>(null);
  const searchId = useId();
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
      <label htmlFor={searchId} className="sr-only">
        Find the shared product for {item.name}
      </label>
      <input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows && rows.length === 0 ? <p className="muted small">No shared products match yet.</p> : null}
      <ul>
        {(rows ?? []).map((r) => (
          <li key={r.key}>
            <button type="button" className="shop-match-option" onClick={() => onPick(r.key)}>
              {r.name}
            </button>
          </li>
        ))}
      </ul>
      {item.matchCorrected ? (
        <button type="button" className="link-btn shop-inline-link" onClick={() => onPick(null)}>
          Match by my item’s name again
        </button>
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  categories,
  store,
  shared,
  today,
  open,
  busy,
  onToggleOpen,
  onChange,
  onPriceTyped,
  onDelete,
}: {
  item: ShoppingItem;
  categories: BudgetCategory[];
  store: ShoppingStore | null;
  /** Shared price for this item at the chosen store, if any. */
  shared: { unitPrice: number; observedOn: string } | null;
  today: string;
  open: boolean;
  busy: boolean;
  onToggleOpen: () => void;
  onChange: (patch: Patch) => void;
  /** A price the user typed (not a shared suggestion they applied). */
  onPriceTyped: (price: number | null) => void;
  onDelete: () => void;
}) {
  const [price, setPrice] = useState(item.estPriceNzd == null ? '' : String(item.estPriceNzd));
  const [matching, setMatching] = useState(false);
  const ids = { details: useId(), price: useId(), category: useId() };
  const category = categories.find((c) => c.id === item.categoryId);

  const commitPrice = () => {
    const next = price.trim() === '' ? null : Number(price);
    if (next === item.estPriceNzd) return;
    if (next === null || (Number.isFinite(next) && next >= 0)) onPriceTyped(next);
    else setPrice(item.estPriceNzd == null ? '' : String(item.estPriceNzd));
  };
  const onPriceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };
  const sub = [
    item.estPriceNzd == null ? 'No price yet' : `${qtyText(item.quantity)} × ${formatNzd(item.estPriceNzd)}`,
    category?.name,
  ].filter(Boolean);
  const suggest = shared && !item.ticked && shared.unitPrice !== item.estPriceNzd ? shared : null;

  return (
    <li className={'shop-item' + (item.ticked ? ' is-ticked' : '') + (open ? ' is-open' : '')}>
      <label className="shop-check">
        <input type="checkbox" checked={item.ticked} disabled={busy} aria-label={`${item.ticked ? 'Untick' : 'Tick'} ${item.name}`} onChange={(e) => onChange({ ticked: e.target.checked })} />
      </label>
      <button type="button" className="shop-item-main" aria-expanded={open} aria-controls={ids.details} onClick={onToggleOpen}>
        <span className="shop-item-name">{item.name}</span>
        <span className="shop-item-sub">{sub.join(' · ')}</span>
      </button>
      <span className="shop-line-total">{item.lineTotalNzd == null ? '—' : formatNzd(item.lineTotalNzd)}</span>

      {!item.ticked ? (
        <div className="shop-item-controls">
          <div className="shop-stepper" role="group" aria-label={`Quantity of ${item.name}`}>
            <button type="button" aria-label={`Decrease quantity of ${item.name}`} disabled={busy || item.quantity <= 1} onClick={() => onChange({ quantity: stepQty(item.quantity, -1) })}>
              −
            </button>
            <span className="shop-stepper-value" aria-live="polite">
              {qtyText(item.quantity)}
            </span>
            <button type="button" aria-label={`Increase quantity of ${item.name}`} disabled={busy} onClick={() => onChange({ quantity: stepQty(item.quantity, 1) })}>
              +
            </button>
          </div>
          <label htmlFor={ids.price} className="sr-only">
            Price each for {item.name} (NZD)
          </label>
          <span className="shop-money-field">
            <span aria-hidden="true">$</span>
            <input
              id={ids.price}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="each"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={onPriceKey}
            />
          </span>
          {suggest ? (
            <button
              type="button"
              className="shop-suggest"
              aria-label={`Use the shared price for ${item.name}: ${formatNzd(suggest.unitPrice)}, ${daysAgo(suggest.observedOn, today)}`}
              onClick={() => {
                setPrice(String(suggest.unitPrice));
                onChange({ estPriceNzd: suggest.unitPrice });
              }}
            >
              Shared {formatNzd(suggest.unitPrice)} · {daysAgo(suggest.observedOn, today)}
            </button>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div id={ids.details} className="shop-item-details">
          <label htmlFor={ids.category}>Budget category</label>
          <select id={ids.category} value={item.categoryId ?? ''} disabled={busy} onChange={(e) => onChange({ categoryId: e.target.value || null })}>
            <option value="">Same as the list</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="shop-detail-line">
            Matched as “{item.productKey}”{item.matchCorrected ? ' (you changed this)' : ''} ·{' '}
            <button type="button" className="link-btn shop-inline-link" aria-expanded={matching} onClick={() => setMatching((m) => !m)}>
              change match
            </button>
          </p>
          {matching ? (
            <MatchPicker
              item={item}
              onPick={(key) => {
                setMatching(false);
                onChange({ productKey: key });
              }}
            />
          ) : null}
          <p className="shop-detail-line muted">
            {store
              ? shared
                ? `Shared price at ${storeLabel(store)}: ${formatNzd(shared.unitPrice)}, last recorded ${daysAgo(shared.observedOn, today)}.`
                : `No shared price at ${storeLabel(store)} yet.`
              : 'Choose a store to see shared prices.'}
          </p>
          <button type="button" className="btn ghost shop-remove" disabled={busy} onClick={onDelete}>
            Remove {item.name}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function ItemsList({
  items,
  categories,
  store,
  storePrices,
  today,
  busy,
  onChange,
  onPriceTyped,
  onDelete,
}: {
  items: ShoppingItem[];
  categories: BudgetCategory[];
  store: ShoppingStore | null;
  /** The comparison's column for the chosen store. */
  storePrices: ShoppingStoreComparison | null;
  today: string;
  busy: boolean;
  onChange: (item: ShoppingItem, patch: Patch) => void;
  onPriceTyped: (item: ShoppingItem, price: number | null) => void;
  onDelete: (item: ShoppingItem) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const toBuy = items.filter((i) => !i.ticked);
  const trolley = items.filter((i) => i.ticked);
  const trolleyTotal = trolley.reduce((s, i) => s + (i.lineTotalNzd ?? 0), 0);

  const row = (i: ShoppingItem) => (
    <ItemRow
      key={`${i.id}:${i.estPriceNzd}`}
      item={i}
      categories={categories}
      store={store}
      shared={storePrices?.items[i.id] ?? null}
      today={today}
      open={openId === i.id}
      busy={busy}
      onToggleOpen={() => setOpenId((o) => (o === i.id ? null : i.id))}
      onChange={(patch) => onChange(i, patch)}
      onPriceTyped={(price) => onPriceTyped(i, price)}
      onDelete={() => onDelete(i)}
    />
  );

  if (items.length === 0) return <p className="shop-empty">Add your first item above.</p>;
  return (
    <>
      {toBuy.length ? <ul className="shop-items">{toBuy.map(row)}</ul> : <p className="shop-empty">Everything’s in the trolley.</p>}
      {trolley.length ? (
        <section className="shop-trolley" aria-label="In the trolley">
          <h4>
            In the trolley · {formatNzd(Math.round(trolleyTotal * 100) / 100)}
          </h4>
          <ul className="shop-items">{trolley.map(row)}</ul>
        </section>
      ) : null}
    </>
  );
}
