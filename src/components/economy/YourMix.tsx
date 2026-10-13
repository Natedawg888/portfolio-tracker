/**
 * "Your mix in this phase" inside Explore the cycle (KAN-31). The user's class shares
 * from Portfolio, paired with the selected phase's general notes. Past patterns only:
 * no forecasts, no advice, nothing estimated.
 */
import { Link } from 'react-router-dom';
import { formatNzd } from '../../api/client';
import { formatShare, mixInPhase, mixSentence, type CycleMix } from '../../lib/cycleMix';

export type MixState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; mix: CycleMix | null };

const TENDENCY_WORDS: Record<string, string> = {
  positive: 'historically positive',
  neutral: 'historically mixed',
  negative: 'historically negative',
};

export function YourMix({
  state,
  phaseLabel,
  assets,
}: {
  state: MixState;
  phaseLabel: string;
  assets: ReadonlyArray<{ id: string; tendency: string; explanation: string }>;
}) {
  return (
    <div className="econ-mix">
      <h4 className="econ-subhead">Your mix in this phase</h4>
      {state.status === 'loading' ? (
        <p className="muted small">Loading your mix…</p>
      ) : state.status === 'error' ? (
        <p className="muted small">Your mix couldn’t be loaded. The rest of the page is unaffected.</p>
      ) : state.mix == null ? (
        <p className="muted small">
          Add holdings on <Link to="/portfolio">Portfolio</Link> to see how {phaseLabel} relates to your mix.
        </p>
      ) : (
        <>
          <p className="small econ-mix-sentence">{mixSentence(state.mix)}</p>
          <ul className="econ-mix-list">
            {mixInPhase(state.mix, assets).map((row) => (
              <li key={row.id}>
                <span className="econ-mix-row">
                  {row.tendency ? (
                    <span className={`tendency tendency-${row.tendency}`}>
                      <span aria-hidden="true">{row.tendency === 'positive' ? '↑' : row.tendency === 'negative' ? '↓' : '→'} </span>
                      {row.label}
                      <span className="sr-only">, {TENDENCY_WORDS[row.tendency] ?? row.tendency} in {phaseLabel}</span>
                    </span>
                  ) : (
                    <strong>{row.label}</strong>
                  )}
                  <span className="econ-mix-share">
                    {formatShare(row.sharePct)} · <span className="money">{formatNzd(row.valueNzd)}</span>
                  </span>
                </span>
                {row.explanation ? <span className="muted small">{row.explanation}</span> : null}
              </li>
            ))}
          </ul>
          {state.mix.notCovered.length > 0 ? (
            <p className="muted small">
              Not covered by these notes:{' '}
              {state.mix.notCovered.map((r) => `${r.label} ${formatShare(r.sharePct)}`).join(' · ')}.
            </p>
          ) : null}
          <p className="muted tiny">
            Your holdings from Portfolio at today’s values (classes turned on in Settings; property at full value, KiwiSaver
            counted as equities). The notes describe past patterns for {phaseLabel}; they are not predictions or advice.
          </p>
        </>
      )}
    </div>
  );
}
