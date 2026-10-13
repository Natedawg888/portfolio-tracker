import { useId, useState, type ReactNode } from 'react';
import { formatNzd } from '../api/client';
import type { PayeBreakdown } from '../lib/payeCalc';
import {
  RESULT_PERIOD_OPTIONS,
  compactBreakdown,
  compactMarker,
  detailBreakdownRows,
  figuresForPeriod,
  grossTakeHomeSplit,
  resultPeriodSuffix,
  splitSummary,
  type DetailBreakdownPeriods,
  type ResultPeriod,
} from '../lib/payeView';
import { PayeChoiceRow } from './PayeChoiceRow';

const PERIOD_COLS: { key: 'hour' | 'week' | 'fortnight' | 'month' | 'year'; label: string }[] = [
  { key: 'hour', label: 'Hour' },
  { key: 'week', label: 'Week' },
  { key: 'fortnight', label: 'Fortnight' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

function money(n: number): string {
  return formatNzd(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function PayeResultPanel({
  result,
  periods,
  hoursPerWeek,
  kiwiSaverOptIn,
  initialPeriod = 'year',
  headingNote,
  notice,
  preface,
  detailExtra,
}: {
  result: PayeBreakdown;
  periods: DetailBreakdownPeriods;
  hoursPerWeek: number;
  kiwiSaverOptIn: boolean;
  /** Display period only. Does not change the saved pay period or the engine. */
  initialPeriod?: ResultPeriod;
  headingNote: string;
  notice?: ReactNode;
  preface?: ReactNode;
  detailExtra?: ReactNode;
}) {
  const [period, setPeriod] = useState<ResultPeriod>(initialPeriod);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailId = useId();
  const breakdownTitleId = useId();
  const figures = figuresForPeriod(periods, result, period, hoursPerWeek);
  const periodLabel = RESULT_PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? period;
  const lines = compactBreakdown(figures);
  const split = grossTakeHomeSplit(figures.gross, figures.takeHome);
  const summary = splitSummary(split, money);
  const rows = detailBreakdownRows(result, periods, kiwiSaverOptIn);

  return (
    <>
      <div className="panel-heading">
        <h2>Take-home pay</h2>
        <span className="muted small">{headingNote}</span>
      </div>
      <p className="paye-result-figure">
        <span className="hero-value">{money(figures.takeHome)}</span>
        <span className="muted">{resultPeriodSuffix(period)}</span>
      </p>
      <PayeChoiceRow
        label="Show as"
        ariaLabel="Show take-home as"
        value={period}
        options={RESULT_PERIOD_OPTIONS}
        onChange={setPeriod}
        nowrap
      />
      {notice}
      <figure className="paye-split">
        <figcaption className="paye-split-caption">
          <span>Gross to take-home</span>
          <span className="money">{money(split.gross)}</span>
        </figcaption>
        {split.parts.length > 0 ? (
          <div className="paye-split-bar" role="img" aria-label={summary}>
            {split.parts.map((part) => (
              <div
                key={part.key}
                className={'paye-split-part paye-split-part--' + part.key}
                style={{ flexGrow: part.share, flexBasis: 0, minWidth: part.share > 0 ? 2 : 0 }}
              />
            ))}
          </div>
        ) : null}
        {split.parts.length > 0 ? (
          <ul className="paye-split-legend">
            {split.parts.map((part) => (
              <li key={part.key}>
                <span className={'paye-split-swatch paye-split-part paye-split-part--' + part.key} aria-hidden="true" />
                <span>{part.label}</span>
                <span className="money">{money(part.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </figure>
      <h3 id={breakdownTitleId} className="paye-result-sub">
        Breakdown <span className="muted">· {periodLabel}</span>
      </h3>
      <ul className="paye-compact" aria-labelledby={breakdownTitleId}>
        {lines.map((line) => (
          <li key={line.key}>
            <span>
              {line.label} <span className="paye-compact-marker">{compactMarker(line.sign)}</span>
            </span>
            <span className={line.sign === 'minus' ? 'money amt-out' : 'money amt-in'}>{money(line.amount)}</span>
          </li>
        ))}
      </ul>
      {preface}
      <button
        type="button"
        className="paye-result-detail-btn"
        aria-expanded={detailOpen}
        aria-controls={detailId}
        onClick={() => setDetailOpen((open) => !open)}
      >
        Detail
        <span aria-hidden="true">{detailOpen ? '\u25B4' : '\u25BE'}</span>
      </button>
      <div id={detailId} className="paye-result-detail" hidden={!detailOpen}>
        {detailExtra}
        <p className="muted small">
          Effective PAYE rate {pct(result.effectiveTaxRate)}
          {result.annualPackage !== result.annualGross ? ` · package ${money(result.annualPackage)}` : ''}
        </p>
        {result.extraCredits.length > 0 && result.extraCreditsTotal > 0 ? (
          <ul className="muted small paye-result-list">
            {result.extraCredits
              .filter((c) => c.credit > 0)
              .map((c) => (
                <li key={c.id}>
                  {c.label}: {money(c.credit)}/yr · assessment / year-end
                </li>
              ))}
          </ul>
        ) : null}
        {result.notes.length > 0 ? (
          <ul className="muted small paye-result-list">
            {result.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        <div className="paye-bracket-wrap">
          <table className="data-table" aria-label="Full breakdown by period">
            <thead>
              <tr>
                <th>Item</th>
                {PERIOD_COLS.map((c) => (
                  <th key={c.key} style={{ textAlign: 'right' }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>
                    {row.label}
                    {row.deduct ? <span className="muted"> ({'\u2212'})</span> : null}
                  </td>
                  {PERIOD_COLS.map((c) => (
                    <td
                      key={c.key}
                      className={
                        row.label === 'Take-home pay' ? 'money amt-in' : row.deduct ? 'money amt-out' : 'money'
                      }
                      style={{ textAlign: 'right' }}
                    >
                      {money(row.amounts[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Employer KiwiSaver is paid by the employer (shown for reference). Month ≠ 2 × fortnight because year ÷ 12 vs
          year ÷ 26.
        </p>
      </div>
    </>
  );
}
