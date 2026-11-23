/**
 * Alerts (KAN-64): what's new about budgets, bills, savings goals and unusual spending, and the
 * settings for each rule and for the daily email. Opening the page raises anything new for today.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AlertItem, AlertSettings } from '../types';
import { ALERT_KIND_LABEL, alertAge } from '../lib/alertsView';
import { notifyAlertsChanged } from '../components/AlertsBell';

export function Alerts() {
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.alerts.list(), api.alerts.settings()])
      .then(([l, s]) => {
        setAlerts(l.alerts);
        setSettings(s.settings);
        setEmailAvailable(s.emailAvailable);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load alerts.'));
  }, []);
  useEffect(load, [load]);

  async function readAll() {
    await api.alerts.read(null);
    notifyAlertsChanged();
    load();
  }

  async function change(patch: Partial<AlertSettings>) {
    try {
      const r = await api.alerts.saveSettings(patch);
      setSettings(r.settings);
      setSaved('Saved.');
      setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  const unread = alerts?.filter((a) => !a.readAt).length ?? 0;
  return (
    <div className="stack bills-page alerts-page">
      <header className="warranties-header">
        <div>
          <h2 className="page-title">Alerts</h2>
          <p className="muted small">Budgets going over, bills coming up, savings goals reached and spending that looks unusual.</p>
        </div>
        <div className="warranties-header-actions">
          {unread ? (
            <button type="button" className="btn small" onClick={() => void readAll()}>
              Mark all read
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="panel">
          <p className="auth-error" role="alert">{error}</p>
          <button type="button" className="btn small" onClick={load}>
            Try again
          </button>
        </div>
      ) : null}
      {!alerts && !error ? <p className="muted">Loading alerts…</p> : null}
      {alerts && !alerts.length ? (
        <section className="panel">
          <h3>Nothing yet</h3>
          <p className="muted small">When a budget goes over, a bill is close, a goal is reached or a purchase looks unusual, it shows up here.</p>
        </section>
      ) : null}
      {alerts?.length ? (
        <section className="panel" aria-label="Your alerts">
          <ul className="alerts-list">
            {alerts.map((a) => (
              <li key={a.id} className={`alerts-item${a.readAt ? '' : ' alerts-unread'}`}>
                <span className="alerts-kind">{ALERT_KIND_LABEL[a.kind]}</span>
                <span className="alerts-main">
                  <strong>{a.link ? <Link to={a.link} onClick={() => void api.alerts.read(a.id).then(notifyAlertsChanged)}>{a.title}</Link> : a.title}</strong>
                  <span className="muted small"> {a.body}</span>
                </span>
                <span className="muted small">{alertAge(a.createdAt, new Date())}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {settings ? (
        <section className="panel" aria-labelledby="alerts-settings-title">
          <h3 id="alerts-settings-title">Settings</h3>
          {saved ? <p className="muted small" role="status">{saved}</p> : null}
          <div className="form-grid">
            <label className="payslip-check span-2">
              <input type="checkbox" checked={settings.overspend} onChange={(e) => void change({ overspend: e.target.checked })} />
              <span>Budget going over</span>
            </label>
            {settings.overspend ? (
              <label>
                Warn at (% of the budget)
                <input type="number" min={50} max={200} step={5} value={settings.overspendPct} onChange={(e) => void change({ overspendPct: Number(e.target.value) })} />
              </label>
            ) : null}
            <label className="payslip-check span-2">
              <input type="checkbox" checked={settings.billDue} onChange={(e) => void change({ billDue: e.target.checked })} />
              <span>Bills coming up</span>
            </label>
            {settings.billDue ? (
              <label>
                Days before
                <input type="number" min={0} max={30} step={1} value={settings.billDaysAhead} onChange={(e) => void change({ billDaysAhead: Number(e.target.value) })} />
              </label>
            ) : null}
            <label className="payslip-check span-2">
              <input type="checkbox" checked={settings.goal} onChange={(e) => void change({ goal: e.target.checked })} />
              <span>Savings goal milestones (25, 50, 75 and 100%)</span>
            </label>
            <label className="payslip-check span-2">
              <input type="checkbox" checked={settings.unusual} onChange={(e) => void change({ unusual: e.target.checked })} />
              <span>Unusual spending</span>
            </label>
            {settings.unusual ? (
              <label>
                When a purchase is this many times the usual
                <input type="number" min={2} max={20} step={1} value={settings.unusualMultiple} onChange={(e) => void change({ unusualMultiple: Number(e.target.value) })} />
              </label>
            ) : null}
            <label className="payslip-check span-2">
              <input type="checkbox" checked={settings.email} disabled={!emailAvailable} onChange={(e) => void change({ email: e.target.checked })} />
              <span>Also email me a daily summary of new alerts{emailAvailable ? '' : ' (email isn’t set up on this server yet)'}</span>
            </label>
          </div>
        </section>
      ) : null}
    </div>
  );
}
