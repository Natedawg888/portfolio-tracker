/**
 * Business assets (KAN-84): add or edit one (livestock, beehives, equipment, vehicles,
 * stock / inventory, other), and record a purchase, sale, birth, death or loss. Values are
 * whatever the user enters; nothing is estimated. Quantities can't be negative.
 */
import { useState } from 'react';
import { ASSET_CATEGORIES, HIVE_STATUSES, MOVEMENT_KINDS, defaultUnit, quantityAfter, type MovementKind } from '../../lib/business';
import type { BusinessAsset, BusinessAssetCategory, BusinessAssetWriteBody } from '../../types';
import { Dialog, FormActions, errorText } from './BusinessUi';

type AssetDraft = {
  category: BusinessAssetCategory;
  name: string;
  quantity: string;
  unit: string;
  cost: string;
  valueMode: 'total' | 'per_unit';
  value: string;
  valuedOn: string;
  animalType: string;
  tag: string;
  location: string;
  status: 'active' | 'dead' | 'sold';
  notes: string;
};

const money = (n: number | null) => (n == null ? '' : String(n));

export function assetDraft(a: BusinessAsset | null, today: string): AssetDraft {
  return {
    category: a?.category ?? 'livestock',
    name: a?.name ?? '',
    quantity: a ? String(a.quantity) : '',
    unit: a?.unit ?? defaultUnit('livestock'),
    cost: money(a?.costNzd ?? null),
    valueMode: a?.valueMode ?? 'per_unit',
    value: money(a?.valueNzd ?? null),
    valuedOn: a?.valuedOn ?? today,
    animalType: a?.animalType ?? '',
    tag: a?.tag ?? '',
    location: a?.location ?? '',
    status: a?.status ?? 'active',
    notes: a?.notes ?? '',
  };
}

const NAME_HINT: Record<BusinessAssetCategory, string> = {
  livestock: 'e.g. Breeding ewes',
  beehives: 'e.g. Home apiary',
  equipment: 'e.g. Honey extractor',
  vehicle: 'e.g. Farm ute',
  stock: 'e.g. Jars and lids',
  other: 'e.g. Shed',
};

function numberOrNull(text: string): number | null {
  return text.trim() === '' ? null : Number(text);
}

function blocker(d: AssetDraft): string | null {
  if (!d.name.trim()) return 'Add a name';
  const q = numberOrNull(d.quantity);
  if (q == null || !Number.isFinite(q)) return 'Add a quantity';
  if (q < 0) return 'Quantity can’t be negative';
  for (const [label, text] of [['Cost', d.cost], ['Value', d.value]] as const) {
    const n = numberOrNull(text);
    if (n != null && (!Number.isFinite(n) || n < 0)) return `${label} can’t be negative`;
  }
  return null;
}

export function AssetForm({ title, initial, today, onSave, onClose }: {
  title: string;
  initial: AssetDraft;
  today: string;
  onSave: (body: BusinessAssetWriteBody) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AssetDraft>(k: K, v: AssetDraft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const hint = blocker(d);
  const counted = d.category === 'livestock' || d.category === 'beehives';

  function setCategory(category: BusinessAssetCategory) {
    setD((prev) => ({
      ...prev,
      category,
      // Swap the unit only while it is still the previous category's default.
      unit: prev.unit === defaultUnit(prev.category) ? defaultUnit(category) : prev.unit,
      valueMode: category === 'livestock' || category === 'beehives' ? prev.valueMode : 'total',
    }));
  }

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        category: d.category,
        name: d.name.trim(),
        quantity: Number(d.quantity),
        unit: d.unit.trim(),
        costNzd: numberOrNull(d.cost),
        valueMode: d.valueMode,
        valueNzd: numberOrNull(d.value),
        valuedOn: d.value.trim() ? d.valuedOn || today : null,
        animalType: d.animalType.trim(),
        tag: d.tag.trim(),
        location: d.location.trim(),
        status: d.status,
        notes: d.notes.trim(),
      });
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          Category
          <select value={d.category} onChange={(e) => setCategory(e.target.value as BusinessAssetCategory)}>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input value={d.name} maxLength={80} placeholder={NAME_HINT[d.category]} autoFocus onChange={(e) => set('name', e.target.value)} />
        </label>
        {d.category === 'livestock' ? (
          <label>
            Animal
            <input value={d.animalType} maxLength={40} placeholder="e.g. sheep, cattle, deer" onChange={(e) => set('animalType', e.target.value)} />
          </label>
        ) : null}
        <label>
          {d.category === 'livestock' ? 'Head count' : d.category === 'beehives' ? 'Hive count' : 'Quantity'}
          <input type="number" min={0} step="any" inputMode="decimal" value={d.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </label>
        {!counted ? (
          <label>
            Unit (optional)
            <input value={d.unit} maxLength={20} placeholder="e.g. kg, items" onChange={(e) => set('unit', e.target.value)} />
          </label>
        ) : null}
        {d.category === 'livestock' ? (
          <label>
            Tag or batch (optional)
            <input value={d.tag} maxLength={60} onChange={(e) => set('tag', e.target.value)} />
          </label>
        ) : null}
        {d.category === 'beehives' ? (
          <>
            <label>
              Apiary location (optional)
              <input value={d.location} maxLength={80} placeholder="e.g. Back paddock" onChange={(e) => set('location', e.target.value)} />
            </label>
            <label>
              Status
              <select value={d.status} onChange={(e) => set('status', e.target.value as AssetDraft['status'])}>
                {HIVE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <label>
          What it cost (optional)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.cost} onChange={(e) => set('cost', e.target.value)} />
        </label>
        <label>
          Value now (optional)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.value} onChange={(e) => set('value', e.target.value)} />
        </label>
        {counted ? (
          <fieldset className="business-value-mode">
            <legend className="muted small">The value is</legend>
            <label>
              <input type="radio" name="value-mode" checked={d.valueMode === 'per_unit'} onChange={() => set('valueMode', 'per_unit')} /> per{' '}
              {d.category === 'livestock' ? 'head' : 'hive'}
            </label>
            <label>
              <input type="radio" name="value-mode" checked={d.valueMode === 'total'} onChange={() => set('valueMode', 'total')} /> in total
            </label>
          </fieldset>
        ) : null}
        {d.value.trim() ? (
          <label>
            Valued on
            <input type="date" max={today} value={d.valuedOn} onChange={(e) => set('valuedOn', e.target.value)} />
          </label>
        ) : null}
        <label className="span-2">
          Notes (optional)
          <textarea value={d.notes} maxLength={1000} rows={2} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      <p className="muted small">
        The value is the one you enter{counted && d.valueMode === 'per_unit' ? `, times the ${d.category === 'livestock' ? 'head count' : 'hive count'}` : ''}. Nothing is estimated.
      </p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel="Save asset" onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}

export function MovementForm({ asset, today, onSave, onClose }: {
  asset: BusinessAsset;
  today: string;
  onSave: (body: { date: string; kind: MovementKind; quantity: number; amountNzd: number | null; notes: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<MovementKind>(asset.category === 'livestock' ? 'birth' : 'purchase');
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = Number(quantity);
  const after = quantity.trim() && Number.isFinite(q) && q > 0 ? quantityAfter(asset.quantity, kind, q) : undefined;
  const hint =
    !quantity.trim() || !Number.isFinite(q) || q <= 0
      ? 'Add how many'
      : after === null
        ? `Only ${asset.quantity} to take from`
        : amount.trim() && (!Number.isFinite(Number(amount)) || Number(amount) < 0)
          ? 'Amount can’t be negative'
          : null;

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ date, kind, quantity: q, amountNzd: amount.trim() ? Number(amount) : null, notes: notes.trim() });
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  // Births are for livestock; deaths for livestock and hives.
  const kinds = MOVEMENT_KINDS.filter(
    (k) => (k.value !== 'birth' || asset.category === 'livestock') && (k.value !== 'death' || asset.category === 'livestock' || asset.category === 'beehives'),
  );
  return (
    <Dialog title={`${asset.name}: record a change`} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          What happened
          <select value={kind} onChange={(e) => setKind(e.target.value as MovementKind)}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          How many
          <input type="number" min={0} step="any" inputMode="decimal" value={quantity} autoFocus onChange={(e) => setQuantity(e.target.value)} />
        </label>
        {kind === 'purchase' || kind === 'sale' ? (
          <label>
            {kind === 'purchase' ? 'Paid' : 'Received'} (optional)
            <input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        ) : null}
        <label className="span-2">
          Notes (optional)
          <input value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <p className="muted small">
        Now {asset.quantity} {asset.unit}
        {after != null ? ` → ${after} ${asset.unit}` : ''}. This changes the count only; money for it comes from what you tag to the business.
      </p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel="Record" onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}
