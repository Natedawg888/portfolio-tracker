/**
 * The business a sub-page (Sales, Suppliers, Budget) belongs to: its detail, the caller's role on
 * it (KAN-129), and whether they can change things. `reload` fetches it again after a change
 * that moves its totals.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { BusinessDetail } from '../../types';
import { errorText } from './BusinessUi';

export function useBusinessInfo(id: string, taxYear: number | null = null) {
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    let cancelled = false;
    api.business
      .get(id, taxYear)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load this business.'));
      });
    return () => {
      cancelled = true;
    };
  }, [id, taxYear, n]);

  const role = detail?.access?.role ?? 'owner';
  return {
    detail,
    error,
    reload,
    name: detail ? detail.business.name || 'Unnamed business' : '',
    role,
    canEdit: role !== 'viewer',
    isOwner: role === 'owner',
  };
}
