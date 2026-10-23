/**
 * "/" for a signed-in account. Personal and Both: the Dashboard. Business only (KAN-124): the
 * business dashboard, which is that business's page when there's exactly one active business,
 * else the overview across them (archived businesses don't count).
 */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Dashboard } from '../pages/Dashboard';

function BusinessHome() {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.business
      .list()
      .then((l) => {
        if (!cancelled) setTo(l.businesses.length === 1 ? `/business/${encodeURIComponent(l.businesses[0].id)}` : '/business');
      })
      .catch(() => {
        if (!cancelled) setTo('/business');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return to ? <Navigate to={to} replace /> : <p className="muted">Loading…</p>;
}

export function HomeRoute() {
  const { user } = useAuth();
  return user?.usageMode === 'business' ? <BusinessHome /> : <Dashboard />;
}
