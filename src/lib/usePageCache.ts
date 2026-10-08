import { useSyncExternalStore } from 'react';
import { readPageCache, subscribePageCache } from './pageDataCache';

/** Live cache slot. Updates when a read commits after this component has mounted. */
export function usePageCacheValue<T>(key: string): T | undefined {
  return useSyncExternalStore(
    subscribePageCache,
    () => readPageCache<T>(key),
    () => undefined,
  );
}
