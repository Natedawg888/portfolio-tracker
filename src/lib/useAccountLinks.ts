import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AccountLinksResponse } from '../types/accountLinks';
import { showAccountsGroup } from './accountLinksView';

const refreshers = new Set<() => void>();

/** After create, link, unlink, or switch. Route changes and opening the menu do not call this. */
export function refreshAccountLinks(): void {
  refreshers.forEach((refresh) => refresh());
}

/**
 * One list fetch per user. A user already known to have no links is not asked again
 * unless a create, link, unlink, or switch asks for a refresh.
 */
export function shouldFetchAccountLinks(input: { userId: string | undefined; emptyForUserId: string | null; force: boolean }): boolean {
  if (!input.userId) return false;
  if (input.force) return true;
  return input.emptyForUserId !== input.userId;
}

/** Cached links belong to this session only. A different current id is dropped. */
export function accountLinksForUser(links: AccountLinksResponse | null, userId: string | undefined): AccountLinksResponse | null {
  if (!links || !userId || links.current.id !== userId) return null;
  return links;
}

/**
 * GET /api/account/links for the header and the profile menu.
 * Fetched once per signed-in user. Users with no links are not fetched again
 * until refreshAccountLinks() (create, link, unlink, or switch).
 * The default business name is asked only when this session is the linked business.
 */
export function useAccountLinks(userId: string | undefined, isLinkedBusiness: boolean) {
  const [links, setLinks] = useState<AccountLinksResponse | null>(null);
  const [activeBusinessName, setActiveBusinessName] = useState<string | null>(null);

  if (links && links.current.id !== userId) {
    setLinks(null);
  }
  if (!isLinkedBusiness && activeBusinessName) {
    setActiveBusinessName(null);
  }

  const visible = accountLinksForUser(links, userId);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const emptyFor = { userId: null as string | null };

    const pull = (force: boolean) => {
      if (!shouldFetchAccountLinks({ userId, emptyForUserId: emptyFor.userId, force })) return;
      api.accountLinks
        .list()
        .then((next) => {
          if (cancelled) return;
          if (next.current.id !== userId) {
            setLinks(null);
            return;
          }
          setLinks(next);
          emptyFor.userId = showAccountsGroup(next) ? null : userId;
        })
        .catch(() => {
          /* keep the list that still belongs to this user */
        });
    };

    pull(false);
    const onRefresh = () => pull(true);
    refreshers.add(onRefresh);
    return () => {
      cancelled = true;
      refreshers.delete(onRefresh);
    };
  }, [userId]);

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

  return { links: visible, activeBusinessName: isLinkedBusiness ? activeBusinessName : null };
}
