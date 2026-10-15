/**
 * Working for Families estimate (KAN-79), inside Household take-home pay. Owners and adults only.
 * Family tax credits are the one part worked out on family income; each person's PAYE stays
 * individual. Educational estimate from IRD's published rates; a year without rates shows a dash.
 * Amounts follow Hide amounts through formatNzd.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { api, formatNzd } from '../../api/client';
import type { HouseholdFamilyView, WffAmounts } from '../../types';
import { longDate } from '../../pages/warrantiesView';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const ROWS: { key: keyof WffAmounts; label: string }[] = [
  { key: 'ftc', label: 'Family tax credit' },
  { key: 'iwtc', label: 'In-work tax credit' },
  { key: 'mftc', label: 'Minimum family tax credit' },
  { key: 'bestStart', label: 'Best Start' },
];
const IRD_CALCULATOR = 'https://myir.ird.govt.nz/tools/?LINK=CLCFAM';
const IRD_APPLY = 'https://www.ird.govt.nz/working-for-families/apply';

type ChildDraft = { id: string; birthMonth: string; memberId: string };

function Details({ view, onSaved, onNote }: { view: HouseholdFamilyView; onSaved: (v: HouseholdFamilyView) => void; onNote: (m: string) => void }) {
  const id = useId();
  const [partners, setPartners] = useState<string[]>(view.partners.map((p) => p.memberId));
  const [children, setChildren] = useState<ChildDraft[]>(view.children.map((c) => ({ id: c.id, birthMonth: c.birthMonth, memberId: c.memberId ?? '' })));
  const [benefit, setBenefit] = useState(view.mainBenefit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thisMonth] = useState(() => new Date().toISOString().slice(0, 7));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const v = await api.household.setFamily({
        partnerIds: partners,
        children: children.map((c) => ({ id: c.id, birthMonth: c.birthMonth, memberId: c.memberId || null })),
        mainBenefit: benefit,
        taxYear: view.taxYear,
      });
      onSaved(v);
      onNote('Family details saved.');
    } catch (err) {
      setError(errText(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="hh-pay-form" onSubmit={save}>
      <fieldset className="hh-pay-fields">
        <legend>Parents or caregivers (one or two)</legend>
        {view.members.map((m) => (
          <label key={m.id} className="hh-share-item">
            <input
              type="checkbox"
              checked={partners.includes(m.id)}
              disabled={!partners.includes(m.id) && partners.length >= 2}
              onChange={(e) => setPartners((p) => (e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id)))}
            />
            <span>{m.name}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="hh-pay-fields">
        <legend>Dependent children</legend>
        {children.map((c, i) => (
          <div key={c.id} className="hh-pay-row hh-child-row">
            <div className="hh-pay-field">
              <label htmlFor={`${id}-b${i}`}>Child {i + 1}: born (month)</label>
              <input id={`${id}-b${i}`} type="month" required max={thisMonth} value={c.birthMonth} onChange={(e) => setChildren((cs) => cs.map((x) => (x.id === c.id ? { ...x, birthMonth: e.target.value } : x)))} />
            </div>
            <div className="hh-pay-field">
              <label htmlFor={`${id}-m${i}`}>In the household as</label>
              <select id={`${id}-m${i}`} value={c.memberId} onChange={(e) => setChildren((cs) => cs.map((x) => (x.id === c.id ? { ...x, memberId: e.target.value } : x)))}>
                <option value="">Not a member</option>
                {view.members
                  .filter((m) => !partners.includes(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
              </select>
            </div>
            <button type="button" className="link-btn hh-edit" aria-label={`Remove child ${i + 1}`} onClick={() => setChildren((cs) => cs.filter((x) => x.id !== c.id))}>
              Remove
            </button>
          </div>
        ))}
        {children.length < 12 ? (
          <button type="button" className="btn ghost" onClick={() => setChildren((cs) => [...cs, { id: `child-${Date.now().toString(36)}`, birthMonth: '', memberId: '' }])}>
            Add a child
          </button>
        ) : null}
      </fieldset>
      <label className="hh-share-item">
        <input type="checkbox" checked={benefit} onChange={(e) => setBenefit(e.target.checked)} />
        <span>The family gets a main benefit (for example Jobseeker Support or Sole Parent Support)</span>
      </label>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="hh-pay-actions">
        <button type="submit" className="btn primary" disabled={busy || !view.canEdit}>
          Save family details
        </button>
      </div>
    </form>
  );
}

export function HouseholdFamily({ taxYear, onNote }: { taxYear: number; onNote: (m: string) => void }) {
  const [view, setView] = useState<HouseholdFamilyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    api.household
      .family(taxYear)
      .then((v) => live && setView(v))
      .catch((e: unknown) => live && setError(errText(e, 'Could not load the family tax credit estimate.')));
    return () => {
      live = false;
    };
  }, [taxYear]);

  if (!view) return error ? <p className="auth-error" role="alert">{error}</p> : null;
  const e = view.estimate;
  const dash = '—';

  return (
    <div className="hh-block">
      <h4>Working for Families estimate</h4>
      <p className="muted small">
        Each person’s tax stays separate. Only these family tax credits are worked out on family income: the parents’ combined pay before tax, from the pay they share here. An estimate for information only, not advice or an
        eligibility decision.
      </p>

      {e ? (
        <>
          <p className="small">
            Family income {formatNzd(view.familyIncomeNzd ?? 0)} a year · {e.dependentChildren === 1 ? '1 dependent child' : `${e.dependentChildren} dependent children`}
            {e.bestStartChildren ? ` · ${e.bestStartChildren} under 3` : ''}
          </p>
          <table className="hh-wff-table">
            <caption className="sr-only">Estimated Working for Families, {view.yearLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Credit</th>
                <th scope="col">A week</th>
                <th scope="col">A year</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td className="money">{formatNzd(e.weekly[r.key])}</td>
                  <td className="money">{formatNzd(e.annual[r.key])}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="money">{formatNzd(e.weekly.total)}</td>
                <td className="money">{formatNzd(e.annual.total)}</td>
              </tr>
            </tfoot>
          </table>
          {e.abated.ftc + e.abated.iwtc + e.abated.bestStart > 0 ? (
            <p className="muted small">
              Family income reduces these by{' '}
              {[
                e.abated.ftc > 0 ? `${formatNzd(e.abated.ftc)} family tax credit` : null,
                e.abated.iwtc > 0 ? `${formatNzd(e.abated.iwtc)} in-work tax credit` : null,
                e.abated.bestStart > 0 ? `${formatNzd(e.abated.bestStart)} Best Start` : null,
              ]
                .filter(Boolean)
                .join(', ')}{' '}
              a year (from {formatNzd(e.full.ftc + e.full.iwtc + e.full.bestStart)} before reduction).
            </p>
          ) : null}
          {e.notes.map((n) => (
            <p key={n} className="muted small">{n}</p>
          ))}
        </>
      ) : (
        <p className="small">
          <span className="hh-wff-dash" aria-label="No estimate">{dash}</span> {view.missing}
        </p>
      )}

      <p className="small">
        Check with <a href={IRD_CALCULATOR} target="_blank" rel="noreferrer">IRD’s Working for Families calculator</a> and{' '}
        <a href={IRD_APPLY} target="_blank" rel="noreferrer">apply through Inland Revenue</a>.
        {view.rates ? ` Rates for ${view.yearLabel}, checked ${longDate(view.rates.checkedOn)}.` : ''}
      </p>
      {view.rates ? (
        <details className="small hh-wff-sources">
          <summary>Sources</summary>
          <ul className="hh-pay-links">
            {view.rates.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {editing ? (
        <Details
          view={view}
          onNote={onNote}
          onSaved={(v) => {
            setView(v);
            setEditing(false);
          }}
        />
      ) : view.canEdit ? (
        <button type="button" className="link-btn hh-edit" onClick={() => setEditing(true)}>
          {view.partners.length || view.children.length ? 'Change family details' : 'Add family details'}
        </button>
      ) : null}
    </div>
  );
}
