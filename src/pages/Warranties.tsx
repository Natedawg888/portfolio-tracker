/**
 * Warranties (KAN-61). Reached from the Budget page (not the nav bar).
 * Phase 1: header counts from the list totals (a short line before the first
 * warranty), an empty state when there are none, and "+ Add warranty" once some
 * exist.
 * Phase 2: the add / edit form (components/warranties/WarrantyForm) with one-tap cover
 * lengths, purchase linking, receipt, and a live "Covered until" line.
 * Phase 3: one card per warranty (status chip, cover-used bar, ⋯ menu), soonest
 * ending first, with an All / Covered / Ending soon / Expired filter.
 * Phase 4: a one-line Consumer Guarantees Act note under the list.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type WarrantyWriteBody } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { showQuietToast } from '../lib/quietToast';
import { WarrantyForm, type WarrantyDraftForm } from '../components/warranties/WarrantyForm';
import { RadioChips } from '../components/warranties/RadioChips';
import { WarrantyCard } from '../components/warranties/WarrantyCard';
import { errText } from '../components/warranties/receiptFile';
import type { Warranty, WarrantyListResponse } from '../types';
import {
  coverChoiceFor,
  emptyFilterText,
  filterOptions,
  filterWarranties,
  sortWarranties,
  warrantiesHeaderLine,
  type WarrantyFilter,
} from './warrantiesView';

const WARRANTIES_KEY = 'warranties';

function draftFor(w: Warranty): WarrantyDraftForm {
  return {
    itemName: w.itemName,
    retailer: w.retailer,
    price: w.priceNzd == null ? '' : String(w.priceNzd),
    startsOn: w.startsOn,
    purchase: w.purchase,
    notes: w.notes,
    ...coverChoiceFor(w.startsOn, w.endsOn),
  };
}

type DialogState = { mode: 'add' } | { mode: 'edit'; item: Warranty } | null;

function WarrantyShield() {
  return (
    <svg className="warranties-empty-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        d="M12 3.2 5.2 6.1v5.9c0 4.1 2.7 7 6.8 8.6 4.1-1.6 6.8-4.5 6.8-8.6V6.1L12 3.2z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.8 12.1 11 14.3 15.3 10"
      />
    </svg>
  );
}

function EmptyWarranties({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="panel warranties-empty" aria-labelledby="warranties-empty-title">
      <WarrantyShield />
      <h3 id="warranties-empty-title">Never miss a free repair</h3>
      <p>Add what you bought and when the cover ends.</p>
      <button type="button" className="btn primary" onClick={onAdd}>
        Add your first warranty
      </button>
    </section>
  );
}

export function Warranties() {
  // Last list from this session shows at once; a fresh one replaces it.
  const [data, setData] = useState<WarrantyListResponse | null>(() => readPageCache<WarrantyListResponse>(WARRANTIES_KEY) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<WarrantyFilter>('all');

  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    const stamp = beginPageRead(WARRANTIES_KEY);
    api.warranties
      .list()
      .then((d) => {
        if (!commitPageRead(stamp, d) || cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (readPageCache<WarrantyListResponse>(WARRANTIES_KEY) != null) {
          showQuietToast('Could not refresh warranties — showing last data.', { kind: 'warn' });
          return;
        }
        setError(errText(e, 'Could not load warranties.'));
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function act(key: string, fn: () => Promise<unknown>, note: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyKey(key);
    setMsg(null);
    try {
      await fn();
      setMsg(note);
      load();
    } catch (e) {
      setError(errText(e, 'Something went wrong.'));
    } finally {
      setBusyKey(null);
    }
  }

  const today = data?.today ?? '';
  const sorted = sortWarranties(data?.items ?? []);
  const shown = filterWarranties(sorted, filter);
  const blank: WarrantyDraftForm = {
    itemName: '',
    retailer: '',
    price: '',
    startsOn: today,
    cover: '12',
    customBy: 'months',
    customMonths: '',
    endsOn: '',
    purchase: null,
    notes: '',
  };

  async function saveNew(body: WarrantyWriteBody, receipt: string | null) {
    const saved = await api.warranties.create(body);
    setDialog(null);
    if (receipt) {
      try {
        await api.warranties.uploadReceipt(saved.id, receipt);
      } catch (e) {
        setMsg(`${body.itemName} added, but the receipt didn’t upload: ${errText(e, 'try again from the list')}.`);
        load();
        return;
      }
    }
    setMsg(`${body.itemName} added.`);
    load();
  }

  async function saveEdit(item: Warranty, body: WarrantyWriteBody, receipt: string | null, removeReceipt: boolean) {
    await api.warranties.update(item.id, body);
    if (receipt) await api.warranties.uploadReceipt(item.id, receipt);
    else if (removeReceipt) await api.warranties.removeReceipt(item.id);
    setDialog(null);
    setMsg(`${body.itemName} updated.`);
    load();
  }

  const openAdd = () => setDialog({ mode: 'add' });

  return (
    <div className="stack bills-page warranties-page">
      <header className="warranties-header">
        <div>
          <Link className="warranties-back" to="/spending">
            ‹ Budget
          </Link>
          <h2 className="page-title">Warranties</h2>
          {data ? (
            <p className="muted small warranties-header-line">{warrantiesHeaderLine(data.items.length, data.totals, data.expiringSoonDays)}</p>
          ) : null}
        </div>
        {data && data.items.length > 0 ? (
          <div className="warranties-header-actions">
            <button type="button" className="btn small primary" onClick={openAdd}>
              + Add warranty
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <section className="panel">
          <p className="auth-error" role="alert">{error}</p>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setError(null);
              load();
            }}
          >
            Try again
          </button>
        </section>
      ) : null}
      {msg ? <p className="banner">{msg}</p> : null}
      {!data && !error ? <p className="muted">Loading warranties…</p> : null}

      {data && data.items.length === 0 ? <EmptyWarranties onAdd={openAdd} /> : null}

      {data && data.items.length > 0 ? (
        <section className="warranties-list" aria-labelledby="warranties-list-title">
          <div className="warranties-list-head">
            <h3 id="warranties-list-title">Your warranties</h3>
            <div className="warranties-filter">
              <span id="warranties-filter-label" className="warranties-filter-label">
                Show
              </span>
              <RadioChips small labelId="warranties-filter-label" options={filterOptions(sorted)} value={filter} onChange={(v) => setFilter(v as WarrantyFilter)} />
            </div>
          </div>
          {shown.length === 0 && filter !== 'all' ? (
            <p className="muted small">{emptyFilterText(filter)}</p>
          ) : (
            <div className="warranty-card-list">
              {shown.map((w) => (
                <WarrantyCard
                  key={w.id}
                  warranty={w}
                  today={today}
                  busy={busyKey != null}
                  onEdit={() => setDialog({ mode: 'edit', item: w })}
                  onDelete={() => void act(w.id, () => api.warranties.remove(w.id), `${w.itemName} deleted.`, `Delete the warranty for ${w.itemName}? Its receipt is deleted too.`)}
                />
              ))}
            </div>
          )}
          <p className="warranties-cga">
            After a warranty ends, the Consumer Guarantees Act can still cover faults for a reasonable time, depending on the
            product and what it cost, so keep the receipt. General information, not legal advice.
          </p>
        </section>
      ) : null}

      {dialog?.mode === 'add' ? (
        <WarrantyForm
          title="Add warranty"
          initial={blank}
          today={today}
          saveLabel="Save warranty"
          existingReceiptUrl={null}
          onClose={() => setDialog(null)}
          onSave={(body, receipt) => saveNew(body, receipt)}
        />
      ) : null}
      {dialog?.mode === 'edit' ? (
        <WarrantyForm
          title={`Edit ${dialog.item.itemName}`}
          initial={draftFor(dialog.item)}
          today={today}
          saveLabel="Save"
          existingReceiptUrl={dialog.item.receiptUrl}
          onClose={() => setDialog(null)}
          onSave={(body, receipt, removeReceipt) => saveEdit(dialog.item, body, receipt, removeReceipt)}
        />
      ) : null}
    </div>
  );
}
