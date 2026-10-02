import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
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

export function AssetClassPrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<AssetClassPrefs>(defaultAssetClassPrefs);
  const [valueSearch, setValueSearch] = useState<ValueSearchPrefs>(defaultValueSearchPrefs);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setPrefs(defaultAssetClassPrefs());
      setValueSearch(defaultValueSearchPrefs());
      return;
    }
    setLoading(true);
    try {
      const r = await api.settings.getAssetClasses();
      setPrefs(normalizeAssetClassPrefs(r.enabled));
      setValueSearch(normalizeValueSearchPrefs(r.valueSearch));
    } catch {
      setPrefs(defaultAssetClassPrefs());
      setValueSearch(defaultValueSearchPrefs());
    } finally {
      setLoading(false);
    }
  }, [user]);

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
