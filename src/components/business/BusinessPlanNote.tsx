/**
 * What KoruLedger Business adds (KAN-125), shown where a business report is locked: the server
 * answers 402 BUSINESS_PLAN_REQUIRED for P&L, the GST return and the accountant export without it.
 * Today's Business pages (businesses, invoices, clients, employees, meetings) stay on every plan.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

export function BusinessPlanNote({ compact = false }: { compact?: boolean }) {
  return (
    <section className="panel business-plan-note" aria-labelledby="business-plan-note-title">
      <h3 id="business-plan-note-title">Part of KoruLedger Business</h3>
      {compact ? (
        <p className="muted small">Profit & loss, the GST return and the accountant export come with the Business plan.</p>
      ) : (
        <>
          <p className="muted">The Business plan adds the books an accountant asks for:</p>
          <ul className="business-plan-list">
            <li>Profit & loss for a tax year or any period, with income and expenses by category</li>
            <li>GST for each return period, laid out to copy into myIR (an estimate to check, not filed for you)</li>
            <li>An export for your accountant: P&L, transactions, invoices and GST</li>
            <li>Access for your accountant to your books</li>
          </ul>
        </>
      )}
    </section>
  );
}

/** Settings → Business: which plan the account is on, and what Business adds when it isn't. */
export function BusinessPlanCard() {
  const [plan, setPlan] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.settings
      .plan()
      .then((p) => {
        if (!cancelled) setPlan(p.features.business_reports ? 'business' : p.plan);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (plan == null) return null;
  if (plan === 'business') {
    return (
      <section className="panel business-plan-note" aria-labelledby="business-plan-on-title">
        <h3 id="business-plan-on-title">KoruLedger Business</h3>
        <p className="muted small">Your plan includes profit & loss, the GST return, the accountant export and accountant access.</p>
      </section>
    );
  }
  return <BusinessPlanNote />;
}
