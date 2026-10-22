/**
 * Stock on the business page (KAN-119): item count, how many need reordering and the value at
 * cost, with links to the Stock page and its stock take.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd } from '../../api/client';
import type { StockItemView } from '../../lib/stock';

export function StockCard({ businessId, archived }: { businessId: string; archived: boolean }) {
  const [items, setItems] = useState<StockItemView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.business
      .stock(businessId)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems(null);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const stockUrl = `/business/${encodeURIComponent(businessId)}/stock`;
  const list = items ?? [];
  const needs = list.filter((i) => ['low', 'out', 'oversold'].includes(i.position.level)).length;
  const atCost = list.reduce<number | null>((s, i) => (i.position.valueNzd == null ? s : (s ?? 0) + i.position.valueNzd), null);

  return (
    <section className="panel warranty-card stock-card" aria-labelledby="biz-stock">
      <div className="rental-card-head">
        <h3 id="biz-stock">Stock</h3>
        <span className="money">{atCost == null ? '—' : formatNzd(atCost)}</span>
      </div>
      <p className="muted small">
        {items == null
          ? 'Goods you buy and sell, with on-hand worked out from purchases, sales, write-offs and stock takes.'
          : list.length === 0
            ? 'No stock items yet.'
            : `${list.length} item${list.length === 1 ? '' : 's'}${needs ? ` · ${needs} need${needs === 1 ? 's' : ''} reordering` : ''} · value at cost`}
      </p>
      <div className="row gap">
        <Link className="btn small primary" to={stockUrl}>
          {list.length ? 'Open stock' : 'Set up stock'}
        </Link>
        {list.length && !archived ? (
          <Link className="btn small" to={`${stockUrl}?take=1`}>
            Stock take
          </Link>
        ) : null}
      </div>
    </section>
  );
}
