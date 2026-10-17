/**
 * Add / edit a room and a tenancy (KAN-83). The server repeats every check (amounts,
 * dates, overlapping tenancies) and its message is shown when it refuses.
 */
import { useId, useState } from 'react';
import type { RentalRoomWriteBody, RentalTenancyWriteBody } from '../../api/client';
import { RENT_FREQUENCIES, tenanciesOverlap, type RentFrequency } from '../../lib/rentalRooms';
import type { RentalTenancy } from '../../types';
import { RadioChips } from '../warranties/RadioChips';
import { errText } from '../warranties/receiptFile';
import { Dialog, FormActions } from './RentalDialog';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

type RoomDraftForm = Omit<RentalRoomWriteBody, 'propertyId' | 'share'> & { share: string };

export function RoomForm({ title, initial, onSave, onClose }: {
  title: string;
  initial: Omit<RentalRoomWriteBody, 'propertyId'>;
  onSave: (body: Omit<RentalRoomWriteBody, 'propertyId'>) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<RoomDraftForm>({ ...initial, share: String(initial.share) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const share = Number(d.share);
  const blocker = !d.name.trim() ? 'Add a name' : !Number.isFinite(share) || share <= 0 || share > 100 ? 'Share must be more than 0' : null;

  async function save() {
    if (blocker) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ name: d.name, note: d.note, share });
    } catch (e) {
      setError(errText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label className="span-2">
          Name
          <input value={d.name} maxLength={60} placeholder="e.g. Room 2" autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <label className="span-2">
          Note (optional)
          <input value={d.note} maxLength={120} placeholder="e.g. ensuite, furnished" onChange={(e) => setD({ ...d, note: e.target.value })} />
        </label>
        <label className="span-2">
          Share of shared costs
          <input type="number" min={0.01} max={100} step="0.01" inputMode="decimal" value={d.share} onChange={(e) => setD({ ...d, share: e.target.value })} />
          <span className="muted small">
            Shared bills are split across rooms by share. Give every room 1 to split evenly, or 1.5 to give a bigger room more.
          </span>
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} disabled={blocker != null} saveLabel="Save room" hint={blocker} onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}

type TenancyDraftForm = Omit<RentalTenancyWriteBody, 'rentAmount' | 'bondAmount' | 'endDate'> & {
  rentAmount: string;
  bondAmount: string;
  endDate: string;
};

function tenancyBlocker(d: TenancyDraftForm, others: readonly RentalTenancy[]): string | null {
  if (!d.tenantLabel.trim()) return 'Add the tenant’s name';
  const rent = Number(d.rentAmount);
  if (d.rentAmount.trim() === '' || !Number.isFinite(rent)) return 'Add the rent';
  if (rent < 0) return 'Rent can’t be negative';
  if (!YMD.test(d.startDate)) return 'Add a start date';
  if (d.endDate && !YMD.test(d.endDate)) return 'Check the end date';
  if (d.endDate && d.endDate < d.startDate) return 'End date is before the start';
  const bond = d.bondAmount.trim() === '' ? 0 : Number(d.bondAmount);
  if (!Number.isFinite(bond) || bond < 0) return 'Bond can’t be negative';
  const span = { startDate: d.startDate, endDate: d.endDate || null };
  const clash = others.find((o) => tenanciesOverlap(span, o));
  if (clash) return `Overlaps ${clash.tenantLabel}’s tenancy`;
  return null;
}

export function TenancyForm({ title, roomName, initial, others, onSave, onClose }: {
  title: string;
  roomName: string;
  initial: RentalTenancyWriteBody;
  /** The room's other tenancies, to catch an overlap before saving. */
  others: readonly RentalTenancy[];
  onSave: (body: RentalTenancyWriteBody) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<TenancyDraftForm>({
    ...initial,
    rentAmount: initial.rentAmount ? String(initial.rentAmount) : '',
    bondAmount: initial.bondAmount ? String(initial.bondAmount) : '',
    endDate: initial.endDate ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const freqLabel = useId();
  const blocker = tenancyBlocker(d, others);
  const set = <K extends keyof TenancyDraftForm>(k: K, v: TenancyDraftForm[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const bond = d.bondAmount.trim() === '' ? 0 : Number(d.bondAmount);

  async function save() {
    if (blocker) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        ...d,
        rentAmount: Number(d.rentAmount),
        bondAmount: bond,
        bondLodged: bond > 0 && d.bondLodged,
        endDate: d.endDate || null,
      });
    } catch (e) {
      setError(errText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <p className="muted small">{roomName}</p>
      <div className="form-grid warranty-form">
        <label className="span-2">
          Tenant
          <input
            value={d.tenantLabel}
            maxLength={60}
            placeholder="e.g. Sam"
            autoFocus
            onChange={(e) => set('tenantLabel', e.target.value)}
          />
          <span className="muted small">A name to recognise them by. No contact details are needed.</span>
        </label>
        <label>
          Rent (NZD)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.rentAmount} onChange={(e) => set('rentAmount', e.target.value)} />
        </label>
        <div className="warranty-field">
          <span id={freqLabel} className="warranty-field-label">
            Paid
          </span>
          <RadioChips labelId={freqLabel} small options={RENT_FREQUENCIES} value={d.rentFrequency} onChange={(v) => set('rentFrequency', v as RentFrequency)} />
        </div>
        <label className="span-2 rental-money-toggle">
          <span>
            <input type="checkbox" checked={d.billsIncluded} onChange={(e) => set('billsIncluded', e.target.checked)} /> Bills included in the rent
          </span>
        </label>
        <label>
          Start date
          <input type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </label>
        <label>
          End date (optional)
          <input type="date" value={d.endDate} min={d.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} />
        </label>
        <label>
          Bond held (NZD, optional)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.bondAmount} onChange={(e) => set('bondAmount', e.target.value)} />
        </label>
        <label className="rental-money-toggle rental-bond-lodged">
          <span>
            <input type="checkbox" checked={bond > 0 && d.bondLodged} disabled={!(bond > 0)} onChange={(e) => set('bondLodged', e.target.checked)} />{' '}
            Lodged with Tenancy Services
          </span>
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} disabled={blocker != null} saveLabel="Save tenancy" hint={blocker} onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}
