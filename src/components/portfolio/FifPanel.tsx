/**
 * Foreign investment fund (FIF) estimate on the Portfolio Dividends tab (KAN-92).
 * Threshold status, FDR and CV, the method used and the FIF income for one tax year, and a
 * per-holding choice to count a share as a FIF or not when the automatic class is wrong.
 * Figures come from GET /api/fif/summary (server/fif/store.ts, formulas in src/lib/fifCalc.ts).
 */
import { useEffect, useState } from 'react';
import { api, formatNzd } from '../../api/client';
import type { FifHoldingRow, FifSummary } from '../../types';
import { InfoTip } from '../InfoTip';

const yearLabel = (start: number) => `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
const nzdOrDash = (n: number | null) => (n == null ? '—' : formatNzd(n));
const AUTO_LABEL: Record<FifHoldingRow['autoClass'], string> = {
  nz: 'NZ-listed',
  nz_fund: 'NZ fund',
  asx_exempt: 'ASX, exempt',
  fif: 'foreign, counts',
};

export function FifPanel() {
  const [taxYear, setTaxYear] = useState<number | null>(null);
  const [data, setData] = useState<FifSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);

  const choose = (h: FifHoldingRow, value: string) => {
    const override = value === 'fif' || value === 'exempt' ? value : null;
    setSaving(h.id);
    setError(null);
    api.fif
      .setClass(h.id, override)
      .then(() => setReload((n) => n + 1))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save.'))
      .finally(() => setSaving(null));
  };

  useEffect(() => {
    let live = true;
    setError(null);
    api.fif
      .summary(taxYear ?? undefined)
      .then((s) => live && setData(s))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load the FIF estimate.'));
    return () => {
      live = false;
    };
  }, [taxYear, reload]);

  const years = data ? [0, 1, 2].map((n) => data.currentTaxYearStart - n) : [];
  const fif = data?.holdings.filter((h) => h.fifClass === 'fif') ?? [];
  const other = data?.holdings.filter((h) => h.fifClass !== 'fif') ?? [];

  return (
    <section className="panel fif-panel" aria-labelledby="fif-title">
      <div className="panel-heading">
        <h3 id="fif-title">
          Foreign investment fund (FIF) estimate
          <InfoTip label="About FIF">
            NZ residents whose foreign shares cost more than $50,000 in total at any time in a tax year return FIF income
            instead of the dividends. It’s usually the lower of the fair dividend rate (5% of the 1 April value) and the
            comparative value (the year’s actual gain, never below zero). Source: IRD IR461 Guide to foreign investment funds.
          </InfoTip>
        </h3>
        {data ? (
          <label className="small">
            Tax year{' '}
            <select value={data.taxYearStart} onChange={(e) => setTaxYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {yearLabel(y)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!data && !error ? <p className="muted">Loading…</p> : null}
      {data ? (
        <>
          <p className="muted small">
            Estimate, not tax advice. {yearLabel(data.taxYearStart)} runs {data.start} to {data.end}.
          </p>
          <dl className="fif-stats">
            <div>
              <dt>Foreign share cost (peak)</dt>
              <dd className="money">{formatNzd(data.peakCostNzd)}</dd>
              <dd className="muted small">
                {data.applies
                  ? `Over the ${formatNzd(data.thresholdNzd)} threshold${data.peakCostDate ? ` from ${data.peakCostDate}` : ''}: FIF applies all year.`
                  : `Under the ${formatNzd(data.thresholdNzd)} threshold: FIF doesn’t apply.`}
              </dd>
            </div>
            {data.applies ? (
              <>
                <div>
                  <dt>Fair dividend rate (FDR)</dt>
                  <dd className="money">{formatNzd(data.fdrTotalNzd)}</dd>
                  <dd className="muted small">5% of the opening value{data.openingSnapshotDate ? ` (snapshot ${data.openingSnapshotDate})` : ''}</dd>
                </div>
                <div>
                  <dt>Comparative value (CV)</dt>
                  <dd className="money">{nzdOrDash(data.cvTotalNzd)}</dd>
                  <dd className="muted small">
                    {data.cvRawTotalNzd == null
                      ? 'Needs the 31 March value'
                      : data.cvRawTotalNzd < 0
                        ? `${formatNzd(data.cvRawTotalNzd)} loss, reduced to zero`
                        : 'Closing + dividends − opening − purchases'}
                  </dd>
                </div>
                <div>
                  <dt>FIF income</dt>
                  <dd className="money">{formatNzd(data.fifIncomeNzd)}</dd>
                  <dd className="muted small">{data.method === 'cv' ? 'Using CV, the lower method' : 'Using FDR'}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>Foreign dividends (taxed as received)</dt>
                <dd className="money">{formatNzd(data.dividendsTaxableNzd)}</dd>
                <dd className="muted small">Gross, in NZD</dd>
              </div>
            )}
          </dl>

          {fif.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Foreign holding</th>
                    <th>Cost</th>
                    <th>1 April value</th>
                    <th>31 March value</th>
                    <th>Dividends</th>
                    <th>FDR</th>
                    <th>CV</th>
                  </tr>
                </thead>
                <tbody>
                  {fif.map((h) => (
                    <tr key={h.id}>
                      <td>{h.label}</td>
                      <td className="money">{nzdOrDash(h.costNzd)}</td>
                      <td className="money">{nzdOrDash(h.openingValueNzd)}</td>
                      <td className="money">{nzdOrDash(h.closingValueNzd)}</td>
                      <td className="money">{formatNzd(h.dividendsNzd)}</td>
                      <td className="money">{nzdOrDash(h.fdrIncomeNzd)}</td>
                      <td className="money">{nzdOrDash(h.cvIncomeNzd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No foreign share holdings count as FIF interests.</p>
          )}
          {other.length ? (
            <p className="muted small">
              Not counted: {other.map((h) => `${h.label} (${h.classLabel})`).join(', ')}.
            </p>
          ) : null}
          {data.holdings.length ? (
            <details className="proj-fold">
              <summary>Which shares count as FIF</summary>
              <p className="muted small">
                Set by the exchange: NZ-listed shares and NZ funds aren’t FIFs, most ASX-listed Australian companies are exempt, and
                everything else counts. Change one if that’s wrong, for example an ASX company without a franking account (check it with
                IRD’s Australian share tool) or a foreign fund that’s exempt.
              </p>
              <ul className="hh-rows">
                {data.holdings.map((h) => (
                  <li key={h.id}>
                    <span>{h.label}</span>
                    <select
                      aria-label={`FIF classification for ${h.label}`}
                      value={h.override ?? 'auto'}
                      disabled={saving === h.id}
                      onChange={(e) => choose(h, e.target.value)}
                    >
                      <option value="auto">Automatic ({AUTO_LABEL[h.autoClass]})</option>
                      <option value="fif">Counts as a FIF</option>
                      <option value="exempt">Not a FIF</option>
                    </select>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <ul className="fif-notes muted small">
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="small">
            <a href={data.sourceUrl} target="_blank" rel="noreferrer">
              {data.sourceLabel} (IRD)
            </a>
          </p>
        </>
      ) : null}
    </section>
  );
}
