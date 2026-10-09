/**
 * Side ad config from /api/ads/config (KAN-72), fetched once per page load.
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AdsConfig } from './ads';

let configPromise: Promise<AdsConfig | null> | null = null;

/** null when the request fails (treated as ads off). */
export function loadAdsConfig(): Promise<AdsConfig | null> {
  configPromise ??= api.ads.config().catch(() => null);
  return configPromise;
}

/** Whether ads are switched on at all; null while loading. */
export function useAdsEnabled(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadAdsConfig().then((c) => {
      if (!cancelled) setOn(!!c && c.mode !== 'off');
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}
