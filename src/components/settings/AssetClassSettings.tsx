/**
 * Settings → Categories & assets: asset classes. Each switch saves straight away (temporary
 * confirmation), grouped Accounts / Investments / Things you own, with what is in each class
 * from the net worth summary. Turning a class off only hides it: holdings stay, and its value
 * still counts in net worth, Projections and History (the server never reads these switches).
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, formatNzd } from '../../api/client';
import { useAssetClassPrefs } from '../../auth/AssetClassPrefsContext';
import { ASSET_CLASS_PREF_OPTIONS, type AssetClassPrefKey, type AssetClassPrefs } from '../../lib/assetClassPrefs';
import { ASSET_CLASS_GROUPS, classContents, contentsText, hiddenText, orderInGroup } from '../../lib/assetClassSummary';
import { showQuietToast } from '../../lib/quietToast';
import type { ValueSearchPrefs } from '../../lib/valueSearchPrefs';

/** Shorter, plainer one-liners than the signup blurbs. */
const DESCRIPTION: Partial<Record<string, string>> = {
  cash: 'NZD bank and wallet balances',
  kiwisaver: 'Your KiwiSaver balance',
  stock: 'Shares and funds, synced or added by ticker',
  crypto: 'Coins, wallets and DeFi',
  gomining: 'GoMining digital miners',
  metal: 'Gold, silver, platinum, palladium',
  forex: 'Foreign currency cash',
  real_estate: 'Property value less the mortgage',
  vehicles: 'Cars, bikes and boats less loans',
  collectable: 'Cards, figurines and other collectables',
  art: 'Physical or fractional art',
  stone: 'Diamonds and gems',
  bonds: 'Bonds and term deposits',
};

/** Settings names where they differ from the signup labels. */
const LABEL: Partial<Record<string, string>> = { cash: 'Cash & banks' };

const toast = (message: string, kind: 'info' | 'warn' = 'info') => showQuietToast(message, { kind, ttlMs: 4000 });

export function AssetClassSettings() {
  const { prefs, valueSearch, loading, save } = useAssetClassPrefs();
  const [local, setLocal] = useState<{ prefs: AssetClassPrefs; vs: ValueSearchPrefs }>({ prefs, vs: valueSearch });
  const [summary, setSummary] = useState<unknown>(null);
  const latest = useRef(local);
  /** Last values the server confirmed, to fall back to if a save fails. */
  const saved = useRef(local);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSaves = useRef(0);

  // Follow the saved preferences unless a save from here is still on its way.
  useEffect(() => {
    const next = { prefs, vs: valueSearch };
    saved.current = next;
    if (pendingSaves.current > 0) return;
    latest.current = next;
    setLocal(next);
  }, [prefs, valueSearch]);

  useEffect(() => {
    let cancelled = false;
    api
      .netWorth()
      .then((s) => !cancelled && setSummary(s))
      .catch(() => {
        // The switches work without it; the contents lines just stay out.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Apply now, save in order; each save sends whatever is current when it runs. */
  function change(next: { prefs: AssetClassPrefs; vs: ValueSearchPrefs }, note: string) {
    latest.current = next;
    setLocal(next);
    pendingSaves.current += 1;
    queue.current = queue.current
      .then(() => save(latest.current.prefs, latest.current.vs))
      .then(
        () => toast(note),
        (err: unknown) => {
          toast(err instanceof ApiError ? err.message : 'Could not save. Your previous choice is back.', 'warn');
          latest.current = saved.current;
          setLocal(saved.current);
        },
      )
      .finally(() => {
        pendingSaves.current -= 1;
      });
  }

  const label = (key: string) => LABEL[key] ?? ASSET_CLASS_PREF_OPTIONS.find((o) => o.key === key)?.label ?? key;
  const setClass = (key: AssetClassPrefKey, on: boolean) =>
    change({ ...latest.current, prefs: { ...latest.current.prefs, [key]: on } }, `${label(key)} ${on ? 'shown' : 'hidden'}`);

  const total = ASSET_CLASS_PREF_OPTIONS.length;
  const onCount = ASSET_CLASS_PREF_OPTIONS.filter((o) => local.prefs[o.key] !== false).length;
  const disabled = loading;

  return (
    <section className="panel settings-assets" aria-labelledby="settings-assets-title">
      <div className="settings-assets-head">
        <div>
          <h2 id="settings-assets-title">Asset classes</h2>
          <p className="muted small" aria-live="polite">
            {onCount} of {total} on · changes save instantly
          </p>
        </div>
        <button
          type="button"
          className="btn small"
          disabled={disabled || onCount === total}
          onClick={() => {
            const all = { ...latest.current.prefs };
            for (const o of ASSET_CLASS_PREF_OPTIONS) all[o.key] = true;
            change({ ...latest.current, prefs: all }, 'Every asset class is on');
          }}
        >
          Turn everything on
        </button>
      </div>
      <p className="muted small settings-assets-lead">
        Hidden classes leave Portfolio, the Dashboard tiles and the menu. Nothing is deleted.
      </p>

      {ASSET_CLASS_GROUPS.map((g) => {
        const rows = orderInGroup(g.id, ASSET_CLASS_PREF_OPTIONS);
        if (rows.length === 0) return null;
        return (
          <div key={g.id} className="settings-asset-group" role="group" aria-labelledby={`asset-group-${g.id}`}>
            <h3 id={`asset-group-${g.id}`}>{g.title}</h3>
            <ul className="asset-toggle-list" role="list">
              {rows.map((opt) => {
                const on = local.prefs[opt.key] !== false;
                const contents = classContents(summary, opt.key);
                const what = contents ? contentsText(contents, formatNzd) : null;
                return (
                  <li key={opt.key}>
                    <button
                      type="button"
                      className={on ? 'asset-toggle on' : 'asset-toggle off'}
                      role="switch"
                      aria-checked={on}
                      aria-labelledby={`asset-${opt.key}-label`}
                      aria-describedby={`asset-${opt.key}-desc`}
                      disabled={disabled}
                      onClick={() => setClass(opt.key, !on)}
                    >
                      <span className="asset-toggle-text">
                        <span className="asset-toggle-label" id={`asset-${opt.key}-label`}>
                          {label(opt.key)}
                        </span>
                        <span id={`asset-${opt.key}-desc`} className="asset-toggle-desc">
                          <span className="asset-toggle-blurb">{DESCRIPTION[opt.key] ?? opt.blurb}</span>
                          {what ? <span className="asset-toggle-contents">{what}</span> : null}
                        </span>
                      </span>
                      <span className="asset-toggle-state" aria-hidden>
                        {on ? 'On' : 'Off'}
                      </span>
                      <span className="asset-toggle-track" aria-hidden>
                        <span className="asset-toggle-knob" />
                      </span>
                    </button>
                    {!on && contents && contents.count > 0 ? (
                      <div className="asset-hidden-note" role="note">
                        <p>
                          {label(opt.key)} is hidden but you have {hiddenText(contents, formatNzd)}. It still counts in your net worth on the
                          Dashboard, in Projections and in History.
                        </p>
                        <button type="button" className="btn small" disabled={disabled} onClick={() => setClass(opt.key, true)}>
                          Turn back on
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <div className="settings-asset-tools">
        <ul className="asset-toggle-list" role="list">
          <li>
            <button
              type="button"
              className={local.vs.showCurrencyExchanger ? 'asset-toggle on' : 'asset-toggle off'}
              role="switch"
              aria-checked={local.vs.showCurrencyExchanger}
              aria-labelledby="asset-fx-tool-label"
              aria-describedby="asset-fx-tool-desc"
              disabled={disabled}
              onClick={() => {
                const on = !latest.current.vs.showCurrencyExchanger;
                change(
                  { ...latest.current, vs: { ...latest.current.vs, showCurrencyExchanger: on } },
                  `Currency converter ${on ? 'on' : 'off'}`,
                );
              }}
            >
              <span className="asset-toggle-text">
                <span className="asset-toggle-label" id="asset-fx-tool-label">
                  Currency converter on Value search
                </span>
                <span className="asset-toggle-blurb" id="asset-fx-tool-desc">
                  Works even if Forex is off
                </span>
              </span>
              <span className="asset-toggle-state" aria-hidden>
                {local.vs.showCurrencyExchanger ? 'On' : 'Off'}
              </span>
              <span className="asset-toggle-track" aria-hidden>
                <span className="asset-toggle-knob" />
              </span>
            </button>
          </li>
        </ul>
      </div>
    </section>
  );
}
