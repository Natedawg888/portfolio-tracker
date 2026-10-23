/**
 * Settings → Account: what the account uses KoruLedger for (KAN-124). Switching changes the nav
 * and where "/" goes; nothing is deleted, and pages that leave the nav stay reachable by address.
 */
import { useState } from 'react';
import { ApiError, api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { showQuietToast } from '../../lib/quietToast';
import { USAGE_MODES, type UsageMode } from '../../lib/usageMode';

export function AccountUsageModeCard() {
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current: UsageMode = user?.usageMode ?? 'personal';

  async function choose(mode: UsageMode) {
    if (!user || mode === current) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.settings.setUsageMode(mode);
      setUser({ ...user, usageMode: r.usageMode, usageModeChosen: true, onboardingComplete: r.onboardingComplete, onboarding: r.onboarding });
      const label = USAGE_MODES.find((m) => m.value === r.usageMode)?.label ?? r.usageMode;
      showQuietToast(`Now using KoruLedger for: ${label}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change what you use KoruLedger for.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel account-card" aria-labelledby="account-usage-title">
      <div className="account-card-head">
        <h2 id="account-usage-title">What you use KoruLedger for</h2>
        <p className="muted small">
          Sets the menu and your home page. Business only hides the personal pages from the menu; their data is kept and they still open by address.
        </p>
      </div>
      <fieldset className="usage-mode-choices" disabled={busy}>
        <legend className="sr-only">What you use KoruLedger for</legend>
        {USAGE_MODES.map((m) => (
          <label key={m.value} className={`usage-mode-choice${current === m.value ? ' active' : ''}`}>
            <input type="radio" name="settings-usage-mode" value={m.value} checked={current === m.value} onChange={() => void choose(m.value)} />
            <span className="usage-mode-text">
              <strong>{m.label}</strong>
              <span className="muted small">{m.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </section>
  );
}
