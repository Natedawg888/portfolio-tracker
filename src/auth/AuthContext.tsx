import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setUnauthorizedHandler, type AuthUser } from '../api/client';
import { clearPageCache, syncPageCacheUser } from '../lib/pageDataCache';

type AuthStatus = {
  hasUsers: boolean;
  userCount: number;
  needsSetup: boolean;
  dataClaimed: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (
    email: string,
    password: string,
    names: { firstName: string; lastName: string },
  ) => Promise<{
    user: AuthUser;
    claimedExistingData: boolean;
    message: string;
  }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeUser(raw: AuthUser | null | undefined): AuthUser | null {
  if (!raw) return null;
  const onboarding = raw.onboarding ?? {
    assetClassesDone: true,
    budgetCategoriesDone: true,
    akahuStepDone: true,
  };
  const onboardingComplete =
    typeof raw.onboardingComplete === 'boolean'
      ? raw.onboardingComplete
      : Boolean(onboarding.assetClassesDone && onboarding.budgetCategoriesDone && onboarding.akahuStepDone);
  return {
    ...raw,
    firstName: raw.firstName?.trim() || null,
    lastName: raw.lastName?.trim() || null,
    displayName: raw.displayName?.trim() || null,
    onboarding: {
      assetClassesDone: Boolean(onboarding.assetClassesDone),
      budgetCategoriesDone: Boolean(onboarding.budgetCategoriesDone),
      akahuStepDone: Boolean(onboarding.akahuStepDone),
    },
    onboardingComplete,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const publishUser = useCallback((next: AuthUser | null) => {
    syncPageCacheUser(next?.id ?? null);
    setUserState(next);
  }, []);

  const setUser = useCallback((next: AuthUser | null) => {
    publishUser(normalizeUser(next));
  }, [publishUser]);

  const refresh = useCallback(async () => {
    try {
      const [me, st] = await Promise.all([api.auth.me(), api.auth.status()]);
      publishUser(normalizeUser(me.user));
      setStatus({
        hasUsers: st.hasUsers,
        userCount: st.userCount,
        needsSetup: st.needsSetup,
        dataClaimed: st.dataClaimed,
      });
    } catch {
      clearPageCache();
      publishUser(null);
    } finally {
      setLoading(false);
    }
  }, [publishUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearPageCache();
      publishUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, [publishUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.auth.login({ email, password });
    const u = normalizeUser(res.user)!;
    publishUser(u);
    const st = await api.auth.status();
    setStatus({
      hasUsers: st.hasUsers,
      userCount: st.userCount,
      needsSetup: st.needsSetup,
      dataClaimed: st.dataClaimed,
    });
    return u;
  }, [publishUser]);

  const register = useCallback(async (
    email: string,
    password: string,
    names: { firstName: string; lastName: string },
  ) => {
    const res = await api.auth.register({
      email,
      password,
      firstName: names.firstName,
      lastName: names.lastName,
    });
    const u = normalizeUser(res.user)!;
    publishUser(u);
    const st = await api.auth.status();
    setStatus({
      hasUsers: st.hasUsers,
      userCount: st.userCount,
      needsSetup: st.needsSetup,
      dataClaimed: st.dataClaimed,
    });
    return {
      user: u,
      claimedExistingData: res.claimedExistingData,
      message: res.message,
    };
  }, [publishUser]);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      clearPageCache();
      publishUser(null);
    }
  }, [publishUser]);

  const value = useMemo(
    () => ({ user, status, loading, refresh, setUser, login, register, logout }),
    [user, status, loading, refresh, setUser, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
