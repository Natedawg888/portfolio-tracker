/**
 * Business → Overview (KAN-84): one full-width card per business for the selected NZ tax year:
 * money in, costs and profit, and the value of its equipment and stock. A business with nothing
 * recorded this year shows setup steps instead of zeros. Two or more businesses get a combined
 * row. Totals come from the server, which counts each dollar once.
 */
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { showQuietToast } from '../lib/quietToast';
import { BUSINESS_TYPES, businessTypeLabel, entriesText, isUnstarted, netWorthNote, profitClass, type BusinessType } from '../lib/business';
import { BusinessFigures, BusinessMark, BusinessTabs, TaxYearSwitch, TypeNote, errorText } from '../components/business/BusinessUi';
import { BusinessForm, blankBusiness, businessBody } from '../components/business/BusinessForm';
import { BusinessSetup } from '../components/business/BusinessSetup';
import { MoreMenu } from '../components/MoreMenu';
import { InfoTip } from '../components/InfoTip';
import type { BusinessCard, BusinessListResponse } from '../types';

const BUSINESS_KEY = 'business-list';

function Card({ b, onEdit, onType }: { b: BusinessCard; onEdit: () => void; onType: (type: BusinessType) => Promise<void> }) {
  const navigate = useNavigate();
  const name = b.name || 'Unnamed business';
  const open = `/business/${b.id}`;
  // The whole card opens the business; its own links, buttons and menu still work.
  function onCardClick(e: MouseEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea, [role="menu"], .more-menu-body')) return;
    if (window.getSelection()?.toString()) return;
    navigate(open);
  }
  return (
    <article className="panel business-card business-card--wide" aria-labelledby={`biz-${b.id}`} onClick={onCardClick}>
      <div className="business-card-head">
        <BusinessMark name={b.name} logoUrl={b.logoUrl} />
        <div className="business-card-title">
          <h3 id={`biz-${b.id}`}>
            <Link to={open}>{name}</Link>
          </h3>
          <p className="muted small">
            {businessTypeLabel(b.type)} · {entriesText(b.activity)}
          </p>
        </div>
        <div className="business-card-actions">
          <Link className="btn small ghost" to={`/business/invoices/new?business=${encodeURIComponent(b.id)}`} aria-label={`New invoice for ${name}`}>
            + Invoice
          </Link>
          <MoreMenu label={`More actions for ${name}`} menu>
            {(close) => (
              <>
                <button type="button" role="menuitem" className="btn small business-menu-item" onClick={() => { close(); navigate(open); }}>
                  Open {name}
                </button>
                <button type="button" role="menuitem" className="btn small business-menu-item" onClick={() => { close(); onEdit(); }}>
                  Edit details
                </button>
              </>
            )}
          </MoreMenu>
        </div>
      </div>
      {isUnstarted(b.totals, b.activity) ? (
        <>
          <BusinessSetup b={b} />
          {b.totals.assetsNzd != null ? (
            <p className="muted small business-card-owns">
              Equipment &amp; stock {formatNzd(b.totals.assetsNzd)} · {netWorthNote(b.countInNetWorth)}
            </p>
          ) : null}
        </>
      ) : (
        <BusinessFigures totals={b.totals} assetsLabel="Equipment & stock" assetsNote={netWorthNote(b.countInNetWorth)} />
      )}
      {b.totals.outstandingNzd > 0 ? <p className="muted small business-card-owed">{formatNzd(b.totals.outstandingNzd)} still owed on sent invoices</p> : null}
      <TypeNote type={b.type} name={name} onChange={onType} />
    </article>
  );
}

/** "+ Add business": name and type, in place. More details are on the business afterwards. */
function AddBusiness({ onAdded, onCancel }: { onAdded: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<BusinessType>('sole_trader');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Add a name');
    setBusy(true);
    setError(null);
    try {
      await api.business.create({ ...blankBusiness(), name: name.trim(), type });
      onAdded(name.trim());
    } catch (err) {
      setError(errorText(err, 'Could not add the business.'));
      setBusy(false);
    }
  }
  return (
    <form className="panel business-add" aria-labelledby="business-add-title" onSubmit={submit} onKeyDown={(e) => (e.key === 'Escape' && !busy ? onCancel() : undefined)}>
      <h3 id="business-add-title">Add a business</h3>
      <label>
        Name
        <input ref={nameRef} value={name} maxLength={120} placeholder="e.g. Hilltop Honey" onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className="business-type-buttons">
        <legend>Type</legend>
        {BUSINESS_TYPES.map((t) => (
          <button key={t.value} type="button" className={'btn small' + (t.value === type ? ' primary' : ' ghost')} aria-pressed={t.value === type} onClick={() => setType(t.value)}>
            {t.label}
          </button>
        ))}
      </fieldset>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add business'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Business() {
  const [data, setData] = useState<BusinessListResponse | null>(() => readPageCache<BusinessListResponse>(BUSINESS_KEY) ?? null);
  const [year, setYear] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BusinessCard | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const stamp = year == null ? beginPageRead(BUSINESS_KEY) : null;
    api.business
      .list(year)
      .then((d) => {
        if ((stamp && !commitPageRead(stamp, d)) || cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (readPageCache<BusinessListResponse>(BUSINESS_KEY) != null) {
          showQuietToast('Could not refresh your businesses — showing last data.', { kind: 'warn' });
          return;
        }
        setError(errorText(e, 'Could not load your businesses.'));
      });
    return () => {
      cancelled = true;
    };
  }, [year, reload]);

  const businesses = data?.businesses ?? [];
  const shownYear = data?.taxYear ?? null;
  const combined =
    businesses.length >= 2
      ? businesses.reduce((s, b) => ({ in: s.in + b.totals.incomeNzd, out: s.out + b.totals.expensesNzd }), { in: 0, out: 0 })
      : null;
  const changeType = (b: BusinessCard) => async (type: BusinessType) => {
    await api.business.update(b.id, { ...businessBody(b), type });
    showQuietToast(`${b.name || 'Business'} is now a ${businessTypeLabel(type).toLowerCase()}.`);
    setReload((n) => n + 1);
  };

  return (
    <div className="stack bills-page warranties-page rentals-page business-page">
      <header className="business-header">
        <div className="business-header-row">
          <h2 className="page-title">Business</h2>
          {shownYear != null && data && businesses.length > 0 ? <TaxYearSwitch year={shownYear} years={data.taxYears} onChange={setYear} /> : null}
          {businesses.length > 0 && !adding ? (
            <button ref={addRef} type="button" className="btn small primary business-header-add" onClick={() => setAdding(true)}>
              + Add business
            </button>
          ) : null}
        </div>
        <BusinessTabs />
      </header>

      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!data && !error ? <p className="muted">Loading your businesses…</p> : null}

      {adding ? (
        <AddBusiness
          onCancel={() => {
            setAdding(false);
            window.setTimeout(() => addRef.current?.focus(), 0);
          }}
          onAdded={(name) => {
            setAdding(false);
            showQuietToast(`${name} added.`);
            setReload((n) => n + 1);
          }}
        />
      ) : null}

      {data && businesses.length === 0 && !adding ? (
        <section className="panel warranties-empty" aria-labelledby="business-empty-title">
          <h3 id="business-empty-title">Track a business</h3>
          <p>
            A card for each business you run, like a beekeeping operation, a farm or contracting work: its money in and costs, its
            livestock, hives and equipment, and its clients and invoices.
          </p>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            Add your first business
          </button>
        </section>
      ) : null}

      {combined ? (
        <section className="panel business-combined" aria-label="All businesses this tax year">
          <h3 className="business-combined-title">
            All businesses{' '}
            <InfoTip label="How money in is counted">
              Money in counts invoice payments and the income and bank deposits you tag to a business. A deposit that pays an invoice is only counted once.
            </InfoTip>
          </h3>
          <dl className="rental-totals business-totals business-totals--three">
            <div>
              <dt>Money in</dt>
              <dd>{formatNzd(combined.in)}</dd>
            </div>
            <div>
              <dt>Costs</dt>
              <dd>{formatNzd(combined.out)}</dd>
            </div>
            <div>
              <dt>Profit</dt>
              <dd className={profitClass(combined.in - combined.out)}>{formatNzd(combined.in - combined.out)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {businesses.length > 0 ? (
        <section className="business-card-list" aria-label="Businesses">
          {businesses.map((b) => (
            <Card key={b.id} b={b} onEdit={() => setEditing(b)} onType={changeType(b)} />
          ))}
        </section>
      ) : null}

      {businesses.length > 0 ? <p className="muted small business-foot">Totals cover the tax year (1 April – 31 March). Values are the ones you enter. General information, not tax advice.</p> : null}

      {editing ? (
        <BusinessForm
          title={`Edit ${editing.name || 'business'}`}
          initial={businessBody(editing)}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await api.business.update(editing.id, body);
            setEditing(null);
            showQuietToast('Details saved.');
            setReload((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
