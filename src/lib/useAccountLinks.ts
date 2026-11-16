import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AccountLinksResponse } from '../types/accountLinks';

/**
 * GET /api/account/links for the header and the profile menu.
 * A failed refresh keeps the last list so a blip does not hide a real link.
 * The default business name is only asked for when this session is the linked business,
 * because that side of the links payload has no businessName.
 */
export function useAccountLinks(userId: string | undefined, isLinkedBusiness: boolean, refreshKey: string) {
  const [links, setLinks] = useState<AccountLinksResponse | null>(null);
  const [activeBusinessName, setActiveBusinessName] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.accountLinks
      .list()
      .then((next) => {
        if (!cancelled) setLinks(next);
      })
      .catch(() => {
        /* keep the previous list */
      });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey, tick]);

  useEffect(() => {
    if (!userId || !isLinkedBusiness) return;
    let cancelled = false;
    api.business
      .list()
      .then((res) => {
        if (cancelled) return;
        const row = res.businesses.find((business) => business.isDefault) ?? res.businesses[0];
        setActiveBusinessName(row?.name?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setActiveBusinessName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isLinkedBusiness]);

  return { links, activeBusinessName, reload };
}
