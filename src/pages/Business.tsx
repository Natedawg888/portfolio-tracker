/**
 * Business → Overview (KAN-84): one card per business the user runs, with income, expenses
 * and net for the selected NZ tax year, the value of its assets, and what is still owed on its
 * invoices. A card opens the business; Invoices and Clients are the other tabs.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { showQuietToast } from '../lib/quietToast';
import { businessTypeLabel, taxYearRange } from '../lib/business';
import { BusinessFigures, BusinessMark, BusinessTabs, TaxYearSwitch, errorText } from '../components/business/BusinessUi';
import { BusinessForm, blankBusiness } from '../components/business/BusinessForm';
import type { BusinessCard, BusinessListResponse } from '../types';

const BUSINESS_KEY = 'business-list';

function Card({ b }: { b: BusinessCard }) {
  const sub = [businessTypeLabel(b.type), b.industry, b.gstRegistered ? 'GST registered' : null].filter(Boolean).join(' · ');
  const counts = [
    `${b.assetCount} ${b.assetCount === 1 ? 'asset' : 'assets'}`,
    b.clientsEnabled ? `${b.clientCount} ${b.clientCount === 1 ? 'client' : 'clients'}` : null,
    `${b.invoiceCount} ${b.invoiceCount === 1 ? 'invoice' : 'invoices'}`,
  ].filter(Boolean).join(' · ');
  return (
    <article className="panel warranty-card business-card" aria-labelledby={`biz-${b.id}`}>
      <div className="business-card-head">
        <BusinessMark name={b.name} logoUrl={b.logoUrl} />
        <div className="warranty-card-title">
          <h4 id={`biz-${b.id}`}>
            <Link to={`/business/${b.id}`}>{b.name || 'Unnamed business'}</Link>
          </h4>
          <p className="warranty-card-sub">{sub}</p>
        </div>
      </div>
      <BusinessFigures totals={b.totals} />
      <p className="muted small business-card-foot">
        {counts}
        {b.totals.outstandingNzd > 0 ? ` · ${formatNzd(b.totals.outstandingNzd)} owed on invoices` : ''}
        {!b.countInNetWorth ? ' · assets not in net worth' : ''}
      </p>
      <div className="rental-card-actions">
        <Link className="btn small" to={`/business/${b.id}`}>
          Open
        </Link>
        <Link className="btn small" to={`/business/invoices/new?business=${encodeURIComponent(b.id)}`}>
          + Invoice
        </Link>
      </div>
    </article>
  );
}

export function Business() {
  const navigate = useNavigate();
  const [data, setData] = useState<BusinessListResponse | null>(() => readPageCache<BusinessListResponse>(BUSINESS_KEY) ?? null);
  const [year, setYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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
  }, [year]);

  const businesses = data?.businesses ?? [];
  const shownYear = data?.taxYear ?? null;
  const range = shownYear ? taxYearRange(shownYear) : null;

  return (
    <div className="stack bills-page warranties-page rentals-page business-page">
      <BusinessTabs />
      <header className="warranties-header">
        <div>
          <h2 className="page-title">Business</h2>
          {shownYear != null && businesses.length > 0 && data ? <TaxYearSwitch year={shownYear} years={data.taxYears} onChange={setYear} /> : null}
        </div>
        {businesses.length > 0 ? (
          <div className="warranties-header-actions">
            <button type="button" className="btn small primary" onClick={() => setAdding(true)}>
              + Add business
            </button>
          </div>
        ) : null}
      </header>

      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!data && !error ? <p className="muted">Loading your businesses…</p> : null}

      {data && businesses.length === 0 ? (
        <section className="panel warranties-empty" aria-labelledby="business-empty-title">
          <h3 id="business-empty-title">Track a business</h3>
          <p>
            A card for each business you run, like a beekeeping operation, a farm or contracting work: its income and
            expenses, its livestock, hives and equipment, and its clients and invoices.
          </p>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            Add your first business
          </button>
        </section>
      ) : null}

      {businesses.length > 0 && range ? (
        <>
          <p className="muted small">
            1 Apr {range.start.slice(0, 4)} – 31 Mar {range.end.slice(0, 4)}. Income counts invoice payments and what you tag to
            the business, each once.
          </p>
          <section className="business-card-grid" aria-label="Businesses">
            {businesses.map((b) => (
              <Card key={b.id} b={b} />
            ))}
          </section>
        </>
      ) : null}

      {adding ? (
        <BusinessForm
          title="Add business"
          initial={blankBusiness()}
          onClose={() => setAdding(false)}
          onSave={async (body) => {
            const created = await api.business.create(body);
            setAdding(false);
            navigate(`/business/${created.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
