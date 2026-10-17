/**
 * One business → "What it owns": Assets and Produce in one card, as tabs with counts.
 *   Assets: livestock, hives, equipment, vehicles and stock the business owns, at the values
 *     you enter. They count in net worth when the business's switch is on.
 *   Produce: commodities held for the business, like honey or wool. Each is a Portfolio →
 *     Commodities holding linked to the business, at a price per unit you set with its date
 *     (there's no live price for these), and counted in net worth there.
 * One add row per tab; the quick-add buttons fill it in. Nothing here estimates a value.
 */
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd } from '../../api/client';
import { ASSET_CATEGORIES, ASSET_QUICK_ADDS, PRODUCE_QUICK_ADDS, defaultUnit, movementKindLabel, type AssetCategory } from '../../lib/business';
import { UNIT_SHORT, type CommodityUnit } from '../../lib/commodities';
import { formatInvoiceDate } from '../../pages/invoicesView';
import type { BusinessAsset, BusinessProduce } from '../../types';
import { errorText } from './BusinessUi';

type Tab = 'assets' | 'produce';

function AssetRow({ a, busy, onEdit, onMove, onDelete, onUndo }: {
  a: BusinessAsset;
  busy: boolean;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  onUndo: (movementId: string) => void;
}) {
  const detail = [
    a.animalType,
    a.tag,
    a.location,
    a.category === 'beehives' && a.status !== 'active' ? (a.status === 'dead' ? 'Dead' : 'Sold') : null,
    a.valueNzd != null && a.valueMode === 'per_unit' ? `${formatNzd(a.valueNzd)} each` : null,
    a.valuedOn ? `valued ${formatInvoiceDate(a.valuedOn)}` : null,
    a.costNzd != null ? `cost ${formatNzd(a.costNzd)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className="rental-entry business-asset">
      <div className="rental-entry-what">
        <span>
          {a.name} <span className="muted">· {a.quantity}{a.unit ? ` ${a.unit}` : ''}</span>
        </span>
        {detail ? <span className="muted small">{detail}</span> : null}
        {a.notes ? <span className="muted small">{a.notes}</span> : null}
        {a.movements.length > 0 ? (
          <details className="business-movements">
            <summary className="small">
              {a.movements.length} {a.movements.length === 1 ? 'change' : 'changes'}
            </summary>
            <ul>
              {a.movements.map((m) => (
                <li key={m.id} className="small">
                  {formatInvoiceDate(m.date)} · {movementKindLabel(m.kind)} {m.quantity}
                  {m.amountNzd != null ? ` · ${formatNzd(m.amountNzd)}` : ''}
                  {m.notes ? ` · ${m.notes}` : ''}{' '}
                  <button type="button" className="link-btn" disabled={busy} aria-label={`Remove this ${movementKindLabel(m.kind).toLowerCase()} from ${a.name}`} onClick={() => onUndo(m.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <span className="rental-entry-amount rental-entry-amount--out">{a.currentValueNzd == null ? '—' : formatNzd(a.currentValueNzd)}</span>
      <span className="rental-entry-actions">
        <button type="button" className="link-btn" disabled={busy} aria-label={`Record a change to ${a.name}`} onClick={onMove}>
          Record change
        </button>
        <button type="button" className="link-btn" disabled={busy} aria-label={`Edit ${a.name}`} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="link-btn" disabled={busy} aria-label={`Delete ${a.name}`} onClick={onDelete}>
          Delete
        </button>
      </span>
    </li>
  );
}

function ProduceRow({ c, busy, onUnlink }: { c: BusinessProduce; busy: boolean; onUnlink: () => void }) {
  const unit = (UNIT_SHORT as Record<string, string>)[c.unit] ?? c.unit;
  const price =
    c.unitPriceNzd != null ? `${formatNzd(c.unitPriceNzd)}/${unit}${c.valueOn ? ` · your price, ${formatInvoiceDate(c.valueOn)}` : ' · your price, no date'}` : 'No price yet, so it isn’t counted';
  return (
    <li className="rental-entry">
      <div className="rental-entry-what">
        <span>
          {c.name} <span className="muted">· {c.quantity} {unit}</span>
          {c.valueNzd != null && c.stale ? <span className="payslip-badge payslip-badge-warn business-stale">Out of date</span> : null}
        </span>
        <span className="muted small">{price}</span>
      </div>
      <span className="rental-entry-amount rental-entry-amount--out">{c.valueNzd == null ? '—' : formatNzd(c.valueNzd)}</span>
      <span className="rental-entry-actions">
        <Link className="link-btn" to="/portfolio#commodities" aria-label={`Update the price of ${c.name} on Portfolio`}>
          Update price
        </Link>
        <button type="button" className="link-btn" disabled={busy} aria-label={`Unlink ${c.name} from this business`} onClick={onUnlink}>
          Unlink
        </button>
      </span>
    </li>
  );
}

type Draft = { name: string; quantity: string; price: string; priceOn: string; category: AssetCategory; preset: string | null; commodityCategory: 'agriculture' | 'other'; unit: string };

export function WhatItOwns({ businessId, businessName, assets, produce, assetsTotal, today, busy, act, onEditAsset, onMoveAsset, onLinkExisting, onChanged }: {
  businessId: string;
  businessName: string;
  assets: BusinessAsset[];
  produce: BusinessProduce[];
  assetsTotal: number | null;
  today: string;
  busy: boolean;
  act: (fn: () => Promise<unknown>, note: string, confirmText?: string) => Promise<void>;
  onEditAsset: (a: BusinessAsset | null, preset?: { category: AssetCategory; name: string }) => void;
  onMoveAsset: (a: BusinessAsset) => void;
  onLinkExisting: () => void;
  onChanged: (note: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('assets');
  const blank = (t: Tab): Draft =>
    t === 'assets'
      ? { name: '', quantity: '', price: '', priceOn: today, category: 'equipment', preset: null, commodityCategory: 'other', unit: '' }
      : { name: '', quantity: '', price: '', priceOn: today, category: 'stock', preset: null, commodityCategory: 'other', unit: 'unit' };
  const [draft, setDraft] = useState<Draft>(blank('assets'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const tabId = (t: Tab) => `${baseId}-${t}-tab`;
  const panelId = (t: Tab) => `${baseId}-${t}-panel`;
  const grouped = ASSET_CATEGORIES.map((c) => ({ ...c, assets: assets.filter((a) => a.category === c.value) })).filter((g) => g.assets.length > 0);
  const produceValue = produce.reduce((s, c) => s + (c.valueNzd ?? 0), 0);
  const unitLabel = draft.unit ? ((UNIT_SHORT as Record<string, string>)[draft.unit] ?? draft.unit) : 'unit';

  function select(t: Tab) {
    setTab(t);
    setDraft(blank(t));
    setError(null);
  }
  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next: Tab = e.key === 'Home' ? 'assets' : e.key === 'End' ? 'produce' : tab === 'assets' ? 'produce' : 'assets';
    select(next);
    window.setTimeout(() => document.getElementById(tabId(next))?.focus(), 0);
  }
  function quickAsset(q: (typeof ASSET_QUICK_ADDS)[number]) {
    setDraft({ ...blank('assets'), category: q.category, name: q.name, unit: defaultUnit(q.category) });
    nameRef.current?.focus();
  }
  function quickProduce(q: (typeof PRODUCE_QUICK_ADDS)[number]) {
    setDraft({ ...blank('produce'), name: q.name, preset: q.preset, commodityCategory: q.category, unit: q.unit });
    nameRef.current?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const qty = Number(draft.quantity);
    const price = draft.price.trim() === '' ? null : Number(draft.price);
    if (!draft.name.trim()) return setError('Add a name');
    if (!(qty > 0)) return setError('Add a quantity');
    if (price != null && !(price >= 0)) return setError(`${tab === 'assets' ? 'Value each' : 'Price per unit'} can’t be negative`);
    setSaving(true);
    setError(null);
    try {
      if (tab === 'assets') {
        await api.business.createAsset(businessId, {
          category: draft.category,
          name: draft.name.trim(),
          quantity: qty,
          unit: draft.unit || defaultUnit(draft.category),
          valueMode: 'per_unit',
          valueNzd: price,
          valuedOn: price == null ? null : today,
        });
      } else {
        // A Portfolio commodity, then linked to this business (two existing calls).
        const before = new Set((await api.commodities.list()).commodities.map((c) => c.id));
        const view = await api.commodities.create({
          name: draft.name.trim(),
          preset: draft.preset,
          category: draft.commodityCategory,
          quantity: qty,
          unit: (draft.unit || 'unit') as CommodityUnit,
          costNzd: null,
          priceNzd: price,
          priceBasis: 'unit',
          valueOn: price == null ? null : draft.priceOn || today,
          notes: `Held for ${businessName || 'a business'}`,
        });
        const created = view.commodities.find((c) => !before.has(c.id));
        if (created) await api.business.linkProduce(created.id, businessId);
      }
      const name = draft.name.trim();
      setDraft(blank(tab));
      onChanged(`${name} added.`);
    } catch (err) {
      setError(errorText(err, 'Could not add it.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel warranty-card business-owns" aria-labelledby={`${baseId}-title`}>
      <div className="rental-card-head">
        <h3 id={`${baseId}-title`}>What it owns</h3>
        <span className="money">{assetsTotal == null ? '—' : formatNzd(assetsTotal)}</span>
      </div>
      <div ref={tablistRef} className="portfolio-tabs business-owns-tabs" role="tablist" aria-label="What it owns" onKeyDown={onTabKey}>
        {(['assets', 'produce'] as const).map((t) => (
          <button
            key={t}
            id={tabId(t)}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={panelId(t)}
            tabIndex={tab === t ? 0 : -1}
            className={`portfolio-tab${tab === t ? ' active' : ''}`}
            onClick={() => select(t)}
          >
            {t === 'assets' ? 'Assets' : 'Produce'} <span className="business-tab-count">{t === 'assets' ? assets.length : produce.length}</span>
          </button>
        ))}
      </div>

      <div id={panelId(tab)} role="tabpanel" aria-labelledby={tabId(tab)} className="business-owns-panel">
        <p className="muted small">
          {tab === 'assets'
            ? 'Hives, equipment, vehicles, livestock and stock, at the values you enter. Counted in net worth when the switch above is on.'
            : 'Honey, wool and other goods held to sell, at a price per unit you set (no live price is looked up). Valued and counted in net worth on '}
          {tab === 'produce' ? <Link to="/portfolio#commodities">Portfolio → Commodities</Link> : null}
          {tab === 'produce' ? '.' : null}
        </p>

        <div className="business-quick-adds" role="group" aria-label={tab === 'assets' ? 'Quick add an asset' : 'Quick add produce'}>
          {tab === 'assets'
            ? ASSET_QUICK_ADDS.map((q) => (
                <button key={q.label} type="button" className="btn small ghost" aria-label={`Add ${q.label.toLowerCase()} to ${businessName || 'this business'}`} onClick={() => quickAsset(q)}>
                  + {q.label}
                </button>
              ))
            : PRODUCE_QUICK_ADDS.map((q) => (
                <button key={q.label} type="button" className="btn small ghost" aria-label={`Add ${q.label.toLowerCase()} to ${businessName || 'this business'}`} onClick={() => quickProduce(q)}>
                  + {q.label}
                </button>
              ))}
        </div>

        <form className="business-add-row" onSubmit={submit} aria-label={tab === 'assets' ? 'Add an asset' : 'Add produce'}>
          <label>
            Name
            <input ref={nameRef} value={draft.name} maxLength={80} placeholder={tab === 'assets' ? 'e.g. Honey extractor' : 'e.g. Mānuka honey'} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>
            Quantity{draft.unit ? ` (${unitLabel})` : ''}
            <input type="number" min={0} step="any" inputMode="decimal" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} />
          </label>
          <label>
            {tab === 'assets' ? 'Value each (NZD)' : `Price per ${unitLabel} (NZD)`}
            <input type="number" min={0} step="any" inputMode="decimal" value={draft.price} placeholder="optional" onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          </label>
          {tab === 'produce' && draft.price.trim() !== '' ? (
            <label>
              Price as of
              <input type="date" value={draft.priceOn} max={today} onChange={(e) => setDraft({ ...draft, priceOn: e.target.value })} />
            </label>
          ) : null}
          <div className="business-add-row-actions">
            <button type="submit" className="btn small primary" disabled={saving || busy}>
              {saving ? 'Adding…' : tab === 'assets' ? 'Add asset' : 'Add produce'}
            </button>
            {tab === 'assets' ? (
              <button type="button" className="link-btn" onClick={() => onEditAsset(null, { category: draft.category, name: draft.name })}>
                More details…
              </button>
            ) : (
              <button type="button" className="link-btn" onClick={onLinkExisting}>
                Link one from Commodities…
              </button>
            )}
          </div>
        </form>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}

        {tab === 'assets' ? (
          grouped.length === 0 ? (
            <p className="muted small">No assets yet.</p>
          ) : (
            grouped.map((g) => (
              <div key={g.value} className="business-asset-group">
                <h4 className="eyebrow">{g.label}</h4>
                <ul className="rental-entries">
                  {g.assets.map((a) => (
                    <AssetRow
                      key={a.id}
                      a={a}
                      busy={busy}
                      onEdit={() => onEditAsset(a)}
                      onMove={() => onMoveAsset(a)}
                      onDelete={() => void act(() => api.business.removeAsset(a.id), `${a.name} deleted.`, `Delete ${a.name} and its ${a.movements.length} recorded changes?`)}
                      onUndo={(movementId) => void act(() => api.business.removeMovement(movementId), 'Change removed.', 'Remove this change? The count goes back.')}
                    />
                  ))}
                </ul>
              </div>
            ))
          )
        ) : produce.length === 0 ? (
          <p className="muted small">No produce yet.</p>
        ) : (
          <>
            <ul className="rental-entries">
              {produce.map((c) => (
                <ProduceRow key={c.id} c={c} busy={busy} onUnlink={() => void act(() => api.business.linkProduce(c.id, null), `${c.name} unlinked. It stays on Portfolio.`)} />
              ))}
            </ul>
            <p className="muted small">Produce worth {formatNzd(produceValue)}, counted in net worth on Portfolio, not in the total above.</p>
          </>
        )}
      </div>
    </section>
  );
}
