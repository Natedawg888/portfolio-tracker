/**
 * Portfolio → Commodities (KAN-81): scrap and industrial metals, energy, agriculture, livestock and
 * anything else physical (precious metals stay in Metals). Pick a common NZ item or type your own.
 * Values are what you set, with the date; there's no live price, and an old value is flagged.
 * Plus shows Commodities as its own class in the asset mix and on the Economic cycle page.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, formatNzd } from '../../api/client';
import type { CommoditiesView, Commodity, CommodityWriteBody } from '../../types';
import {
  CATEGORY_LABEL,
  CATEGORY_UNITS,
  COMMODITY_CATEGORIES,
  COMMODITY_PRESETS,
  COMMODITY_UNITS,
  STALE_AFTER_DAYS,
  UNIT_LABEL,
  UNIT_SHORT,
  commodityFigures,
  presetByKey,
  quantityText,
  type CommodityCategory,
  type CommodityUnit,
  type PriceBasis,
} from '../../lib/commodities';
import { longDate } from '../../pages/warrantiesView';
import { todayAucklandYmd } from '../../lib/period';
import { ClassHeading } from './ClassHeading';
import { InfoTip } from '../InfoTip';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const s = (n: number | null | undefined) => (n == null ? '' : String(n));
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
const todayYmd = todayAucklandYmd;
/** Per-unit prices under $1 keep up to 4 decimals ($0.0850/kg). */
const unitPrice = (n: number) => (n >= 1 ? formatNzd(n) : `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatNzd(Math.abs(n))}`;

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn small modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const OWN = '';

function CommodityForm({ item, onClose, onSaved }: { item: Commodity | null; onClose: () => void; onSaved: (v: CommoditiesView, note: string) => void }) {
  const [preset, setPreset] = useState(item?.preset ?? OWN);
  const [name, setName] = useState(item && !item.preset ? item.name : '');
  const [category, setCategory] = useState<CommodityCategory>(item?.category ?? 'industrial_metals');
  const [quantity, setQuantity] = useState(s(item?.quantity));
  const [unit, setUnit] = useState<CommodityUnit>(item?.unit ?? 'kg');
  const [cost, setCost] = useState(s(item?.costNzd));
  const [basis, setBasis] = useState<PriceBasis>(item?.priceBasis ?? 'unit');
  const [price, setPrice] = useState(s(item?.priceNzd));
  const [valueOn, setValueOn] = useState(item?.valueOn ?? todayYmd());
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = presetByKey(preset);
  function choose(key: string) {
    setPreset(key);
    const p = presetByKey(key);
    if (p) {
      setCategory(p.category);
      setUnit(p.unit);
    }
  }

  const qty = Number(quantity);
  const preview = qty > 0 && price !== '' ? commodityFigures({ quantity: qty, priceNzd: Number(price), priceBasis: basis, costNzd: numOrNull(cost), valueOn }, todayYmd()) : null;
  const blocker = !picked && !name.trim() ? 'Choose an item or type what it is' : !(qty > 0) ? 'Enter how much you have' : price !== '' && !valueOn ? 'Enter the date of that price' : null;
  const units = [...CATEGORY_UNITS[category], ...COMMODITY_UNITS.filter((u) => !CATEGORY_UNITS[category].includes(u))];

  async function save() {
    setBusy(true);
    setError(null);
    const body: CommodityWriteBody = {
      name: picked ? picked.name : name.trim(),
      preset: picked?.key ?? null,
      category,
      quantity: qty,
      unit,
      costNzd: numOrNull(cost),
      priceNzd: numOrNull(price),
      priceBasis: basis,
      valueOn: price === '' ? null : valueOn || null,
      notes: notes.trim(),
    };
    try {
      const v = item ? await api.commodities.update(item.id, body) : await api.commodities.create(body);
      onSaved(v, item ? `${body.name} updated.` : `${body.name} added.`);
    } catch (e) {
      setError(errText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={item ? `Edit ${item.name}` : 'Add a commodity'} onClose={onClose}>
      <div className="form-grid crypto-form">
        <label className="span-2">
          What is it?
          <select value={preset} onChange={(e) => choose(e.target.value)}>
            <option value={OWN}>Something else (type it)</option>
            {COMMODITY_CATEGORIES.filter((c) => c !== 'other').map((c) => (
              <optgroup key={c} label={CATEGORY_LABEL[c]}>
                {COMMODITY_PRESETS.filter((p) => p.category === c).map((p) => (
                  <option key={p.key} value={p.key}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="muted small">Gold, silver, platinum and palladium go in Metals, which has live spot prices.</span>
        </label>
        {!picked ? (
          <label>
            Name
            <input value={name} maxLength={80} placeholder="e.g. Pine logs" onChange={(e) => setName(e.target.value)} />
          </label>
        ) : null}
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as CommodityCategory)}>
            {COMMODITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label>
          Quantity
          <input type="number" min={0} step="any" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label>
          Unit
          <select value={unit} onChange={(e) => setUnit(e.target.value as CommodityUnit)}>
            {units.map((u) => (
              <option key={u} value={u}>{UNIT_LABEL[u]}</option>
            ))}
          </select>
        </label>
        <label>
          What you paid (optional)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          <span className="muted small">Blank counts as $0 when working out your return.</span>
        </label>
        <fieldset className="span-2 commodity-basis">
          <legend>Value</legend>
          <label>
            <input type="radio" name="basis" checked={basis === 'unit'} onChange={() => setBasis('unit')} /> Price per {UNIT_SHORT[unit]}
          </label>
          <label>
            <input type="radio" name="basis" checked={basis === 'total'} onChange={() => setBasis('total')} /> Total value
          </label>
        </fieldset>
        <label>
          {basis === 'unit' ? `NZD per ${UNIT_SHORT[unit]}` : 'Total value (NZD)'}
          <input type="number" min={0} step="any" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          <span className="muted small">From a quote, buyer or yard. Leave blank if you don’t know it; nothing is looked up.</span>
        </label>
        <label>
          Price as of
          <input type="date" value={valueOn} max={todayYmd()} onChange={(e) => setValueOn(e.target.value)} />
        </label>
        {preview?.valueNzd != null ? (
          <p className="span-2 small" aria-live="polite">
            Worth {formatNzd(preview.valueNzd)}
            {basis === 'total' && preview.unitPriceNzd != null ? ` (${unitPrice(preview.unitPriceNzd)}/${UNIT_SHORT[unit]})` : ''}
            {preview.returnNzd != null ? `, ${signed(preview.returnNzd)} on cost` : ''}.
            {preview.stale ? ` That price is over ${STALE_AFTER_DAYS} days old, so it will show as out of date.` : ''}
          </p>
        ) : null}
        <label className="span-2">
          Notes (optional)
          <input value={notes} maxLength={300} placeholder="e.g. grade, where it’s stored, who quoted" onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !!blocker} onClick={() => void save()}>
          {item ? 'Save changes' : 'Add'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        {blocker ? <span className="muted small">{blocker}</span> : null}
      </div>
    </Dialog>
  );
}

function CommodityCard({ c, onEdit, onDelete }: { c: Commodity; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className="payslip-card">
      <div className="payslip-card-top">
        <div>
          <h4>{c.name}</h4>
          <p className="muted small">
            {CATEGORY_LABEL[c.category]} · {quantityText(c.quantity, c.unit)}
          </p>
        </div>
        {c.businessName != null ? (
          <span className="payslip-badge">Part of {c.businessName || 'a business'}</span>
        ) : c.valueNzd == null ? (
          <span className="payslip-badge">No value</span>
        ) : c.stale ? (
          <span className="payslip-badge payslip-badge-warn">Out of date</span>
        ) : null}
      </div>
      <dl className="payslip-figs">
        <div>
          <dt>Value</dt>
          <dd className="money">{c.valueNzd != null ? formatNzd(c.valueNzd) : '—'}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd className="money">{formatNzd(c.costNzd ?? 0)}</dd>
        </div>
        <div>
          <dt>Return</dt>
          <dd className="money">
            {c.returnNzd != null ? signed(c.returnNzd) : '—'}
            {c.returnPct != null ? <span className="muted small"> ({c.returnPct >= 0 ? '+' : ''}{c.returnPct.toFixed(1)}%)</span> : null}
          </dd>
        </div>
      </dl>
      <p className="small muted">
        {c.valueNzd == null
          ? `Add a price to count it in ${c.businessName != null ? `${c.businessName || 'its business'}’s value` : 'net worth'}.`
          : `${c.unitPriceNzd != null ? `${unitPrice(c.unitPriceNzd)}/${UNIT_SHORT[c.unit]}` : ''}${c.priceBasis === 'total' ? ' (from your total)' : ''} · your price${c.valueOn ? `, ${longDate(c.valueOn)}` : ''}.`}
        {c.stale && c.valueNzd != null ? ` Over ${STALE_AFTER_DAYS} days old: check a current price.` : ''}
        {c.notes ? ` ${c.notes}` : ''}
        {c.businessName != null && c.valueNzd != null ? ` Counted in ${c.businessName || 'its business'}’s value on Business, not in this total.` : ''}
      </p>
      <div className="payslip-actions">
        <button type="button" className="link-btn" onClick={onEdit}>
          {c.stale || c.valueNzd == null ? 'Update price' : 'Edit'}
        </button>
        <button type="button" className="link-btn" onClick={onDelete}>
          Delete
        </button>
      </div>
    </article>
  );
}

export function CommoditiesPanel({ total, onChanged }: { total: number | null; onChanged: () => void }) {
  const [view, setView] = useState<CommoditiesView | null>(null);
  const [form, setForm] = useState<{ item: Commodity | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.commodities.list().then(setView).catch((e: unknown) => setError(errText(e, 'Could not load commodities.')));
  }, []);
  useEffect(load, [load]);
  const changed = (v: CommoditiesView, note: string) => {
    setView(v);
    setMsg(note);
    setForm(null);
    onChanged();
  };

  const groups = COMMODITY_CATEGORIES.map((cat) => ({ cat, items: view?.commodities.filter((c) => c.category === cat) ?? [] })).filter((g) => g.items.length);
  const t = view?.totals;

  return (
    <section className="panel">
      <ClassHeading
        title="Commodities"
        total={total}
        info={
          <InfoTip label="About commodity values">
            Scrap and industrial metals, fuel, farm produce, livestock and other goods, at the price you set and the date of that price. Nothing is looked up: yard and
            buyer prices vary by grade, so a value over {STALE_AFTER_DAYS} days old is marked out of date. A holding with no price shows a dash and isn’t counted.
          </InfoTip>
        }
      >
        <button type="button" className="btn small primary" onClick={() => setForm({ item: null })} disabled={!view}>
          + Add
        </button>
      </ClassHeading>
      {msg ? <p className="banner">{msg}</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!view && !error ? <p className="muted">Loading…</p> : null}

      {view && !view.commodities.length ? <p className="muted">No commodities yet. Add scrap metal, honey, wool, milk solids, diesel, livestock or anything else you hold.</p> : null}
      {t && view?.commodities.length ? (
        <p className="small muted">
          {t.costNzd > 0 || t.returnNzd !== 0 ? `${signed(t.returnNzd)} on ${formatNzd(t.costNzd)} cost. ` : ''}
          {t.unvalued ? `${t.unvalued} without a price, not counted. ` : ''}
          {t.stale ? `${t.stale} with a price over ${STALE_AFTER_DAYS} days old.` : ''}
        </p>
      ) : null}

      {groups.map((g) => (
        <div key={g.cat}>
          <h4 className="bond-sub">{CATEGORY_LABEL[g.cat]}</h4>
          <div className="payslip-list">
            {g.items.map((c) => (
              <CommodityCard
                key={c.id}
                c={c}
                onEdit={() => setForm({ item: c })}
                onDelete={() => window.confirm(`Delete ${c.name}?`) && void api.commodities.remove(c.id).then((v) => changed(v, `${c.name} deleted.`))}
              />
            ))}
          </div>
        </div>
      ))}

      {view && view.commodities.length && !view.plus ? (
        <p className="small payslip-plan">Counted in your net worth. KoruLedger Plus also shows Commodities as its own class in your asset mix and on the Economic cycle page.</p>
      ) : null}

      {form ? <CommodityForm item={form.item} onClose={() => setForm(null)} onSaved={changed} /> : null}
    </section>
  );
}
