/**
 * Settings → Account: personalised or non-personalised ads (KAN-72).
 * Hidden while ads are switched off. Stored in this browser.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AD_PREF_EVENT, readAdPersonalisation, setAdPersonalisation, type AdPersonalisation } from '../lib/ads';
import { useAdsEnabled } from '../lib/adsConfig';

export function AdPrefsPanel() {
  const enabled = useAdsEnabled();
  const [choice, setChoice] = useState<AdPersonalisation>(() => readAdPersonalisation(window.localStorage) ?? 'non_personalised');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const sync = () => setChoice(readAdPersonalisation(window.localStorage) ?? 'non_personalised');
    window.addEventListener(AD_PREF_EVENT, sync);
    return () => window.removeEventListener(AD_PREF_EVENT, sync);
  }, []);

  if (!enabled) return null;
  const pick = (v: AdPersonalisation) => {
    setAdPersonalisation(v);
    setChoice(v);
    setSaved(true);
  };
  return (
    <section className="panel" id="ads">
      <h3>Ads</h3>
      <p className="muted small">
        Ads show beside the page on wide screens and at the bottom on smaller ones. Ads never see your balances, holdings, pay or payees.{' '}
        <Link to="/privacy#advertising">How ads work</Link>
      </p>
      <fieldset className="ad-prefs" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-only">Ad personalisation</legend>
        <label>
          <input type="radio" name="ad-pref" checked={choice === 'non_personalised'} onChange={() => pick('non_personalised')} /> Not
          personalised (default)
        </label>
        <label>
          <input type="radio" name="ad-pref" checked={choice === 'personalised'} onChange={() => pick('personalised')} /> Personalised by
          Google
        </label>
      </fieldset>
      {saved ? <p className="muted small">Saved in this browser. Applies from the next page load.</p> : null}
    </section>
  );
}
