/** "Recent activity": the latest sign-ins and passkey changes, 5 at first, all 10 on request. */
import { useState } from 'react';
import type { AccountSecurity } from '../../api/client';
import { eventText, shortWhen } from '../../lib/securityView';
import { MethodIcon } from './MethodIcon';

const FIRST = 5;

export function RecentActivity({ data }: { data: AccountSecurity }) {
  const [all, setAll] = useState(false);
  const events = data.recentSignIns;
  const shown = all ? events : events.slice(0, FIRST);

  return (
    <section className="panel security-section" id="activity" aria-labelledby="activity-title">
      <h3 id="activity-title">Recent activity</h3>
      <p className="security-lead">Sign-ins and passkey changes on this account. Device names are approximate.</p>
      {events.length === 0 ? (
        <p className="muted">None recorded yet.</p>
      ) : (
        <ul className="security-rows" id="activity-list">
          {shown.map((e) => {
            const { text, icon } = eventText(e, data.ssoProviders);
            return (
              <li key={e.id} className="security-row">
                <MethodIcon kind={icon} />
                <div className="security-row-main">
                  <p className="security-row-name">
                    {text}
                    {e.newDevice ? <span className="security-chip">New device</span> : null}
                  </p>
                  <p className="security-row-sub">
                    {shortWhen(e.createdAt)} · {e.deviceLabel ?? 'Unknown device'}
                    {e.current ? ' · this device' : e.signedIn ? ' · still signed in' : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {events.length > FIRST ? (
        <div className="security-section-foot">
          <button type="button" className="btn small" aria-expanded={all} aria-controls="activity-list" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${events.length}`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
