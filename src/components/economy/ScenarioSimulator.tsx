import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { overridesKey, pct, scenarioOverrides } from '../../lib/economyView';
import type { EconomicCycleResponse, EconomicScenarioResult } from '../../types/economy';

const DEBOUNCE_MS = 350;

/**
 * What-if panel. Slider values live only in this component. The server re-scores
 * them with the same rules and saves nothing; the real phase above is untouched.
 */
export function ScenarioSimulator({ data }: { data: EconomicCycleResponse }) {
  const inputs = data.scenarioInputs;
  const initial = useMemo(() => {
    const out: Record<string, number> = {};
    for (const input of inputs) if (input.value != null) out[input.indicator] = input.value;
    return out;
  }, [inputs]);
  const [draft, setDraft] = useState<Record<string, number>>(initial);
  const [result, setResult] = useState<EconomicScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cache = useRef(new Map<string, EconomicScenarioResult>());

  const overrides = useMemo(() => scenarioOverrides(inputs, draft), [inputs, draft]);
  const key = overridesKey(overrides);

  useEffect(() => {
    if (!key) {
      setResult(null);
      setError(null);
      setPending(false);
      return;
    }
    const hit = cache.current.get(key);
    if (hit) {
      setResult(hit);
      setError(null);
      setPending(false);
      return;
    }
    setPending(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.economy
        .scenario({ country: data.country, overrides }, { signal: controller.signal })
        .then((payload) => {
          cache.current.set(key, payload);
          setResult(payload);
          setError(null);
        })
        .catch((err: Error) => {
          if (controller.signal.aborted) return;
          setError(err.message || 'The scenario could not be scored.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setPending(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `overrides` is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, data.country]);

  if (!data.phase) {
    return (
      <section className="panel econ-scenario" aria-labelledby="econ-scenario-title">
        <h2 id="econ-scenario-title">What-if scenarios</h2>
        <p className="muted small">The current quarter could not be scored, so there is nothing to compare a scenario against.</p>
      </section>
    );
  }

  const shown = result && key ? result : null;
  const baselineFits = shown?.baseline.phaseFits ?? data.phaseFits;
  const changedPhase = shown && shown.scenario.phase !== shown.baseline.phase;

  return (
    <section className="panel econ-scenario" aria-labelledby="econ-scenario-title">
      <div className="panel-heading">
        <h2 id="econ-scenario-title">What-if scenarios</h2>
        <button type="button" className="btn small ghost" disabled={!key} onClick={() => setDraft(initial)}>
          Reset to actual
        </button>
      </div>
      <p className="econ-hypothetical">
        <span aria-hidden="true">⚑ </span>
        Hypothetical. Move a slider to see how the same scoring rules would read different figures. Nothing is saved, the real data is not refreshed, and this is not a forecast.
      </p>

      <div className="econ-scenario-grid">
        <div className="econ-sliders">
          {inputs.map((input) => {
            const value = draft[input.indicator];
            const disabled = input.value == null;
            const id = `econ-slider-${input.indicator}`;
            const moved = value != null && input.value != null && Math.abs(value - input.value) > 1e-9;
            return (
              <div key={input.indicator} className={`econ-slider${moved ? ' is-moved' : ''}`}>
                <label htmlFor={id}>
                  <span>{input.label}</span>
                  <strong>{disabled ? 'No data' : `${value!.toFixed(input.step < 0.1 ? 2 : 1)}%`}</strong>
                </label>
                <input
                  id={id}
                  type="range"
                  min={input.min}
                  max={input.max}
                  step={input.step}
                  value={value ?? input.min}
                  disabled={disabled}
                  aria-describedby={`${id}-hint`}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setDraft((prev) => ({ ...prev, [input.indicator]: next }));
                  }}
                />
                <span id={`${id}-hint`} className="muted tiny">
                  {disabled
                    ? 'No real reading this quarter, so the model cannot evaluate a change.'
                    : `Actual ${input.value!.toFixed(input.step < 0.1 ? 2 : 1)}%`}
                </span>
              </div>
            );
          })}
        </div>

        <div className="econ-scenario-result" aria-live="polite" aria-busy={pending}>
          {error ? (
            <p className="news-status" role="alert">
              {error}
            </p>
          ) : null}
          <p className="econ-scenario-verdict">
            {!key
              ? `Actual: ${data.phase.label}. Move a slider to compare.`
              : pending && !shown
                ? 'Scoring scenario…'
                : shown
                  ? changedPhase
                    ? `Scenario would read as ${shown.scenario.phaseLabel ?? 'no phase'} (actual: ${shown.baseline.phaseLabel}).`
                    : `Scenario still reads as ${shown.scenario.phaseLabel}.`
                  : ''}
          </p>
          {shown ? (
            <p className="muted tiny">
              Confidence {shown.baseline.confidence} → {shown.scenario.confidence} · Overall score {shown.baseline.score} →{' '}
              {shown.scenario.score}
            </p>
          ) : null}
          <ul className="econ-fit-bars econ-fit-bars--compare">
            {baselineFits.map((row) => {
              const scenarioFit = shown?.scenario.phaseFits.find((item) => item.id === row.id)?.fit ?? null;
              return (
                <li key={row.id} className={row.id === data.phase!.id ? 'is-current' : undefined}>
                  <span className="econ-fit-label">{row.label}</span>
                  <span className="econ-fit-track econ-fit-track--double" aria-hidden="true">
                    <span className="is-actual" style={{ width: `${pct(row.fit)}%` }} />
                    {scenarioFit != null ? <span className="is-scenario" style={{ width: `${pct(scenarioFit)}%` }} /> : null}
                  </span>
                  <span className="econ-fit-value">
                    {row.fit}
                    {scenarioFit != null && scenarioFit !== row.fit ? ` → ${scenarioFit}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="econ-legend muted tiny">
            <span className="econ-key is-actual" aria-hidden="true" /> Actual fit
            <span className="econ-key is-scenario" aria-hidden="true" /> Scenario fit
          </p>
          {shown && shown.unavailable.length > 0 ? (
            <p className="muted tiny">Not evaluated (no real reading): {shown.unavailable.map((row) => row.label).join(', ')}.</p>
          ) : null}
          {shown ? (
            <p className="muted tiny">
              Each changed figure is compared with the real previous reading to decide whether it is rising or falling. Other indicators keep their actual values.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
