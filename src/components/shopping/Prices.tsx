/**
 * Under the item list: what happens to typed prices, and the explicit "Share N prices" action
 * (option b: typed prices stay private until the user chooses to share them). Then the store
 * comparison, which only uses prices KoruLedger users shared, never estimates.
 */
import { formatNzd } from '../../api/client';
import type { ShoppingCompareResponse, ShoppingListDetail, ShoppingStore } from '../../types';
import { cheapestComparable, qtyText, storeLabel } from '../../lib/shoppingView';
import { longDate } from '../../pages/warrantiesView';

export function PriceNote({
  store,
  sharing,
  pending,
  busy,
  onShare,
  onOpenSettings,
}: {
  store: ShoppingStore | null;
  sharing: boolean;
  /** Prices typed at this store since the last share. */
  pending: number;
  busy: boolean;
  onShare: () => void;
  onOpenSettings: () => void;
}) {
  const settings = (
    <button type="button" className="link-btn shop-inline-link" onClick={onOpenSettings}>
      Price sharing settings
    </button>
  );
  if (!store || !sharing) {
    return (
      <div className="shop-price-note">
        <p>Prices you type are saved to this list and kept private.{store ? ' Sharing is off.' : ''}</p>
        {settings}
      </div>
    );
  }
  return (
    <div className="shop-price-note">
      <p>Prices you type are saved to this list and kept private until you share them.</p>
      {settings}
      {pending > 0 ? (
        <button type="button" className="btn shop-share-btn" disabled={busy} onClick={onShare}>
          Share {pending} price{pending === 1 ? '' : 's'} for {storeLabel(store)}
        </button>
      ) : null}
    </div>
  );
}

export function CompareStores({ list, data, onAddStore }: { list: ShoppingListDetail; data: ShoppingCompareResponse | null; onAddStore: () => void }) {
  if (!data) return <p className="muted small">Loading prices…</p>;
  if (data.stores.length < 2) {
    return (
      <div className="shop-compare-hint">
        <p>{data.stores.length === 0 ? 'Add the stores you shop at to compare prices.' : 'Add another store to compare prices.'}</p>
        <button type="button" className="btn shop-add-store-btn" onClick={onAddStore}>
          + Add a store
        </button>
      </div>
    );
  }
  const { store: cheapest, sameItems } = cheapestComparable(data.stores);
  const anyPriced = data.stores.some((s) => s.pricedCount > 0);
  const saving = cheapest && data.split?.savingVsCheapest != null && data.split.savingVsCheapest > 0.004 ? data.split.savingVsCheapest : null;

  return (
    <div className="shop-compare">
      <ul className="shop-compare-stores">
        {data.stores.map((s) => {
          const isCheapest = cheapest === s;
          return (
            <li key={`${s.chain}|${s.branch}`} className={isCheapest ? 'is-cheapest' : ''}>
              <span className="shop-compare-name">
                {storeLabel(s)}
                {isCheapest ? <span className="shop-cheapest-badge">Cheapest</span> : null}
              </span>
              <span className="shop-compare-total">
                {s.pricedCount ? formatNzd(s.total) : '—'}
                <span className="shop-compare-count">
                  {s.pricedCount} of {data.itemCount} priced
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {anyPriced && !sameItems ? <p className="shop-compare-note">These totals cover different items, so none is marked cheapest.</p> : null}
      {saving != null ? <p className="shop-compare-note">Buying each item where it’s cheapest would save about {formatNzd(saving)}.</p> : null}
      {anyPriced ? (
        <details className="shop-compare-details">
          <summary>Prices per item</summary>
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table className="data-table shop-compare-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  {data.stores.map((s) => (
                    <th key={`${s.chain}|${s.branch}`} scope="col" style={{ textAlign: 'right' }}>
                      {storeLabel(s)}
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
            </table>
          </div>
        </details>
      ) : null}
      <p className="shop-compare-disclaimer">Uses prices shared in the last {data.windowDays} days. Prices change in store.</p>
    </div>
  );
}
