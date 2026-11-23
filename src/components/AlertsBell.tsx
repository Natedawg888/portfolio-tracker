/**
 * Header bell (KAN-64): a link to Alerts with the unread count. Refreshes on page changes, every
 * 5 minutes, and when the Alerts page marks something read.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';

const EVENT = 'koru-alerts-changed';
export const notifyAlertsChanged = () => window.dispatchEvent(new Event(EVENT));

export function AlertsBell() {
  const { pathname } = useLocation();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let live = true;
    const load = () =>
      api.alerts
        .list()
        .then((r) => live && setUnread(r.unread))
        .catch(() => {});
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    window.addEventListener(EVENT, load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(EVENT, load);
    };
  }, [pathname]);

  const label = unread ? `Alerts, ${unread} unread` : 'Alerts';
  return (
    <Link to="/alerts" className="alerts-bell" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" />
      </svg>
      {unread ? <span className="alerts-badge">{unread > 99 ? '99+' : unread}</span> : null}
    </Link>
  );
}
