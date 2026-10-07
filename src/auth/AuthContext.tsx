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
  /** Password step. With 2FA on (and an untrusted browser) returns a challenge instead of a user. */
  login: (email: string, password: string, opts?: { remember?: boolean }) => Promise<LoginResult>;
  /** Second step: authenticator or backup code for the challenge from `login`. */
  completeTwoFactor: (
    challenge: string,
    code: string,
    trustDevice: boolean,
  ) => Promise<{ user: AuthUser; usedBackupCode: boolean; backupCodesRemaining: number | null }>;
  register: (
    email: string,
    password: string,
    names: { firstName: string; lastName: string },
  ) => Promise<{
    user: AuthUser;
    claimedExistingData: boolean;
    message: string;
  }>;
  /** Signs the active account out; if another account is signed in here, the app reloads as it. */
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  /** Make another account signed in on this browser active (reloads the app). */
  switchAccount: (userId: string) => Promise<void>;
};

export type LoginResult =
  | { kind: 'signedIn'; user: AuthUser }
  | { kind: 'twoFactor'; challenge: string; expiresAt: string };

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

  const setUser = useCallback((next: AuthUser | null) => {
    setUserState(normalizeUser(next));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [me, st] = await Promise.all([api.auth.me(), api.auth.status()]);
      setUserState(normalizeUser(me.user));
      setStatus({
        hasUsers: st.hasUsers,
        userCount: st.userCount,
        needsSetup: st.needsSetup,
        dataClaimed: st.dataClaimed,
      });
    } catch {
      setUserState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUserState(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signedIn = useCallback(async (raw: AuthUser) => {
    const u = normalizeUser(raw)!;
    setUserState(u);
    const st = await api.auth.status();
    setStatus({
      hasUsers: st.hasUsers,
      userCount: st.userCount,
      needsSetup: st.needsSetup,
      dataClaimed: st.dataClaimed,
    });
    return u;
  }, []);

  const login = useCallback(
    async (email: string, password: string, opts: { remember?: boolean } = {}): Promise<LoginResult> => {
      const res = await api.auth.login({ email, password, remember: opts.remember ?? true });
      if (res.twoFactorRequired) return { kind: 'twoFactor', challenge: res.challenge, expiresAt: res.expiresAt };
      return { kind: 'signedIn', user: await signedIn(res.user) };
    },
    [signedIn],
  );

  const completeTwoFactor = useCallback(
    async (challenge: string, code: string, trustDevice: boolean) => {
      const res = await api.auth.loginTwoFactor({ challenge, code, trustDevice });
      return {
        user: await signedIn(res.user),
        usedBackupCode: Boolean(res.usedBackupCode),
        backupCodesRemaining: res.backupCodesRemaining ?? null,
      };
    },
    [signedIn],
  );

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
    setUserState(u);
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
  }, []);

  const logout = useCallback(async () => {
    let next: string | null = null;
    try {
      next = (await api.auth.logout()).switchedToUserId;
    } finally {
      // A full reload drops every cached page of the previous account.
      if (next) window.location.assign('/');
      else setUserState(null);
    }
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await api.auth.logoutAll();
    } finally {
      setUserState(null);
    }
  }, []);

  const switchAccount = useCallback(async (userId: string) => {
    await api.auth.switchAccount(userId);
    window.location.assign('/');
  }, []);

  const value = useMemo(
    () => ({ user, status, loading, refresh, setUser, login, completeTwoFactor, register, logout, logoutAll, switchAccount }),
    [user, status, loading, refresh, setUser, login, completeTwoFactor, register, logout, logoutAll, switchAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
