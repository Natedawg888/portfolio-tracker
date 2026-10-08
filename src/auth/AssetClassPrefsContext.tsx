import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import {
  defaultAssetClassPrefs,
  isAssetClassEnabled,
  normalizeAssetClassPrefs,
  type AssetClassPrefKey,
  type AssetClassPrefs,
} from '../lib/assetClassPrefs';
import {
  defaultValueSearchPrefs,
  normalizeValueSearchPrefs,
  type ValueSearchPrefs,
} from '../lib/valueSearchPrefs';
import { useAuth } from './AuthContext';

type Ctx = {
  prefs: AssetClassPrefs;
  valueSearch: ValueSearchPrefs;
  loading: boolean;
  refresh: () => Promise<void>;
  save: (
    next: AssetClassPrefs,
    valueSearch?: ValueSearchPrefs,
  ) => Promise<{ prefs: AssetClassPrefs; valueSearch: ValueSearchPrefs }>;
  enabled: (key: AssetClassPrefKey) => boolean;
};

const AssetClassPrefsContext = createContext<Ctx | null>(null);

type AssetClassCache = { prefs: AssetClassPrefs; valueSearch: ValueSearchPrefs };

const ASSET_CLASSES_KEY = 'asset-classes';

export function AssetClassPrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [boundUser, setBoundUser] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<AssetClassPrefs>(defaultAssetClassPrefs);
  const [valueSearch, setValueSearch] = useState<ValueSearchPrefs>(defaultValueSearchPrefs);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (userId !== boundUser) {
    setBoundUser(userId);
    if (!userId) {
      setPrefs(defaultAssetClassPrefs());
      setValueSearch(defaultValueSearchPrefs());
      setLoadedFor(null);
    } else {
      const cached = readPageCache<AssetClassCache>(ASSET_CLASSES_KEY);
      setPrefs(cached?.prefs ?? defaultAssetClassPrefs());
      setValueSearch(cached?.valueSearch ?? defaultValueSearchPrefs());
      setLoadedFor(cached ? userId : null);
    }
  }

  const loading = Boolean(userId) && loadedFor !== userId;
  const loadedForRef = useRef(loadedFor);
  useEffect(() => {
    loadedForRef.current = loadedFor;
  }, [loadedFor]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setPrefs(defaultAssetClassPrefs());
      setValueSearch(defaultValueSearchPrefs());
      setLoadedFor(null);
      return;
    }
    const stamp = beginPageRead(ASSET_CLASSES_KEY);
    try {
      const r = await api.settings.getAssetClasses();
      const savedPrefs = normalizeAssetClassPrefs(r.enabled);
      const savedVs = normalizeValueSearchPrefs(r.valueSearch);
      if (!commitPageRead(stamp, { prefs: savedPrefs, valueSearch: savedVs })) return;
      setPrefs(savedPrefs);
      setValueSearch(savedVs);
      setLoadedFor(userId);
    } catch {
      if (loadedForRef.current !== userId) {
        setPrefs(defaultAssetClassPrefs());
        setValueSearch(defaultValueSearchPrefs());
      }
      setLoadedFor(userId);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (next: AssetClassPrefs, nextValueSearch?: ValueSearchPrefs) => {
      const normalized = normalizeAssetClassPrefs(next);
      const vs = normalizeValueSearchPrefs(nextValueSearch ?? valueSearch);
      const r = await api.settings.setAssetClasses(normalized, vs);
      const savedPrefs = normalizeAssetClassPrefs(r.enabled);
      const savedVs = normalizeValueSearchPrefs(r.valueSearch);
      const stamp = beginPageRead(ASSET_CLASSES_KEY);
      commitPageRead(stamp, { prefs: savedPrefs, valueSearch: savedVs });
      setPrefs(savedPrefs);
      setValueSearch(savedVs);
      return { prefs: savedPrefs, valueSearch: savedVs };
    },
    [valueSearch],
  );

  const enabled = useCallback(
    (key: AssetClassPrefKey) => isAssetClassEnabled(prefs, key),
    [prefs],
  );

  const value = useMemo(
    () => ({ prefs, valueSearch, loading, refresh, save, enabled }),
    [prefs, valueSearch, loading, refresh, save, enabled],
  );

  return (
    <AssetClassPrefsContext.Provider value={value}>{children}</AssetClassPrefsContext.Provider>
  );
}

export function useAssetClassPrefs(): Ctx {
  const ctx = useContext(AssetClassPrefsContext);
  if (!ctx) throw new Error('useAssetClassPrefs must be used within AssetClassPrefsProvider');
  return ctx;
}
