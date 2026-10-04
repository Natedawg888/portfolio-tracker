import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import { ApiError, api } from '../api/client';
import { AssetClassToggles } from '../components/AssetClassToggles';
import {
  defaultAssetClassPrefs,
  type AssetClassPrefs,
} from '../lib/assetClassPrefs';
import {
  akahuConnect,
  akahuStatus,
  akahuSync,
  akahuSyncTransactions,
  type AkahuConnectionStatus,
} from '../api/akahuClient';
import {
  CATEGORY_TYPES,
  CATEGORY_TYPE_LABELS,
  normalizeCategoryType,
  type CategoryType,
} from '../lib/categoryTypes';
import { CategoryTypeToggle } from '../components/CategoryTypeToggle';
import { akahuOnboardingRequiredForEmail } from '../lib/onboardingPrefs';

type Step = 'credentials' | 'assets' | 'budgets' | 'connect';

type TxCategory = {
  id: string;
  slug?: string;
  name: string;
  parentId: string | null;
  colour: string | null;
  type: CategoryType;
  isIncome: boolean;
  sortOrder: number;
};

function stepFromOnboarding(user: {
  email?: string | null;
  onboardingComplete: boolean;
  onboarding: {
    assetClassesDone: boolean;
    budgetCategoriesDone: boolean;
    akahuStepDone: boolean;
  };
}): Step | 'done' {
  if (user.onboardingComplete) return 'done';
  if (!user.onboarding.assetClassesDone) return 'assets';
  if (!user.onboarding.budgetCategoriesDone) return 'budgets';
  // Only Nathan is offered the Akahu checkpoint. Everyone else is already skipped.
  if (!akahuOnboardingRequiredForEmail(user.email) || user.onboarding.akahuStepDone) return 'done';
  return 'connect';
}

export function Register() {
  const { user, loading, register, status, setUser, refresh } = useAuth();
  const { save: savePrefs } = useAssetClassPrefs();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('credentials');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [prefs, setPrefs] = useState<AssetClassPrefs>(() => defaultAssetClassPrefs());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const midSignupRef = useRef(false);
  const [resumed, setResumed] = useState(false);

  const [categories, setCategories] = useState<TxCategory[]>([]);
  const [catBusy, setCatBusy] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<CategoryType>('spending');

  const [akahu, setAkahu] = useState<AkahuConnectionStatus | null>(null);

  // Resume incomplete onboarding after refresh / login redirect.
  useEffect(() => {
    if (loading || resumed) return;
    if (!user) {
      setResumed(true);
      return;
    }
    if (midSignupRef.current) {
      setResumed(true);
      return;
    }
    const next = stepFromOnboarding(user);
    if (next === 'done') {
      setResumed(true);
      return;
    }
    setStep(next);
    midSignupRef.current = true;
    setResumed(true);
  }, [loading, user, resumed]);

  const loadCategories = useCallback(async () => {
    try {
      const rows = await api.budgets.categories();
      setCategories(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load categories');
    }
  }, []);

  useEffect(() => {
    if (step === 'budgets' && user) void loadCategories();
  }, [step, user, loadCategories]);

  const loadAkahu = useCallback(async () => {
    try {
      setAkahu(await akahuStatus());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Akahu status');
    }
  }, []);

  useEffect(() => {
    if (step === 'connect' && user) void loadAkahu();
  }, [step, user, loadAkahu]);

  // Everyone except Nathan: record the same skip the "Skip / do later" button writes,
  // so signup and later sign-in never stop on the Akahu checkpoint.
  useEffect(() => {
    if (loading || !user) return;
    if (akahuOnboardingRequiredForEmail(user.email)) return;
    if (user.onboarding.akahuStepDone) return;
    let active = true;
    void (async () => {
      try {
        const r = await api.settings.setOnboarding({ akahuStepDone: true });
        if (!active) return;
        if (!r.onboarding.akahuStepDone) {
          setError('Could not skip bank setup');
          return;
        }
        setUser({
          ...user,
          onboardingComplete: r.onboardingComplete,
          onboarding: r.onboarding,
        });
        if (r.onboardingComplete) {
          midSignupRef.current = false;
          navigate('/', { replace: true });
        }
      } catch (err) {
        if (active) {
          setError(err instanceof ApiError ? err.message : 'Could not skip bank setup');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [loading, user, setUser, navigate]);

  // Signup decides from the address on this form. Resume uses the signed-in account.
  // That keeps the Akahu step out of create-account for every email except Nathan's.
  const accountEmail = user?.email || email;
  const offerAkahu = akahuOnboardingRequiredForEmail(accountEmail);
  const blockingAkahuSkip = Boolean(
    user &&
      !offerAkahu &&
      !user.onboarding.akahuStepDone &&
      user.onboarding.assetClassesDone &&
      user.onboarding.budgetCategoriesDone,
  );

  // Finished onboarding and not mid Akahu step → home.
  // Incomplete users stay on /register (RequireAuth also redirects here).
  // midSignupRef prevents bouncing home just because user was set after credentials.
  // Non-Nathan accounts never stay on the connect step, even if it was opened.
  if (
    !loading &&
    resumed &&
    user?.onboardingComplete &&
    (step !== 'connect' || !offerAkahu)
  ) {
    return <Navigate to="/" replace />;
  }

  if (!loading && resumed && blockingAkahuSkip) {
    return (
      <div className="auth-page">
        <div className="auth-card panel">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  const firstUser = Boolean(status?.needsSetup);

  const onCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first) {
      setError('First name is required');
      return;
    }
    if (!last) {
      setError('Last name is required');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    midSignupRef.current = true;
    // Advance UI immediately so the post-register user state cannot redirect away.
    setStep('assets');
    try {
      const res = await register(email, password, { firstName: first, lastName: last });
      if (res.claimedExistingData) setInfo(res.message);
    } catch (err) {
      midSignupRef.current = false;
      setStep('credentials');
      setError(err instanceof ApiError ? err.message : 'Could not create account');
    } finally {
      setBusy(false);
    }
  };

  const onAssets = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    midSignupRef.current = true;
    try {
      await savePrefs(prefs);
      await refresh();
      setStep('budgets');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save asset preferences');
    } finally {
      setBusy(false);
    }
  };

  const onAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    const name = newCatName.trim();
    if (!name) return;
    setCatBusy(true);
    setError(null);
    try {
      await api.budgets.createCategory({ name, type: newCatType });
      setNewCatName('');
      setNewCatType('spending');
      await loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add category');
    } finally {
      setCatBusy(false);
    }
  };

  const onDeleteCategory = async (cat: TxCategory) => {
    if (
      !window.confirm(
        `Remove category “${cat.name}”? Transactions keep their history but lose this category tag.`,
      )
    ) {
      return;
    }
    setCatBusy(true);
    setError(null);
    try {
      await api.budgets.deleteCategory(cat.id);
      await loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove category');
    } finally {
      setCatBusy(false);
    }
  };

  const onBudgets = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    midSignupRef.current = true;
    try {
      const r = await api.settings.setOnboarding(
        offerAkahu
          ? { budgetCategoriesDone: true }
          : { budgetCategoriesDone: true, akahuStepDone: true },
      );
      setUser(
        user
          ? {
              ...user,
              onboardingComplete: r.onboardingComplete,
              onboarding: r.onboarding,
            }
          : user,
      );
      await refresh();
      if (r.onboardingComplete) {
        midSignupRef.current = false;
        navigate('/', { replace: true });
        return;
      }
      // Create-account for anyone except Nathan never opens the Akahu step.
      if (!offerAkahu) return;
      setStep('connect');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save budget categories setup');
    } finally {
      setBusy(false);
    }
  };

  const completeAkahuStep = async (message: string) => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.settings.setOnboarding({ akahuStepDone: true });
      if (user) {
        setUser({
          ...user,
          onboardingComplete: r.onboardingComplete,
          onboarding: r.onboarding,
        });
      }
      await refresh();
      midSignupRef.current = false;
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : message);
    } finally {
      setBusy(false);
    }
  };

  const onConnectAkahu = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const st = await akahuStatus();
      setAkahu(st);
      if (!st.oauthReady) {
        setInfo(
          st.canSync
            ? 'Open Akahu to link or manage your accounts, then return here and use “Sync & finish”.'
            : st.sharedTokenConfigured
              ? 'This Personal App token is available only to the first account. You can still skip this optional step, or configure Full App OAuth later.'
              : 'Akahu OAuth is not configured yet. You can skip this optional step and connect later in Settings.',
        );
        return;
      }
      const r = await akahuConnect();
      if (r.authorizeUrl) {
        window.location.href = r.authorizeUrl;
        return;
      }
      setError('No authorize URL returned');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start Akahu Connect');
    } finally {
      setBusy(false);
    }
  };

  const onSyncAndFinish = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const st = await akahuStatus();
      setAkahu(st);
      if (!st.canSync) {
        setInfo('Akahu is not connected for this account. Use “Skip / do later”, or connect in Settings later.');
        return;
      }
      await akahuSync();
      await akahuSyncTransactions();
      await completeAkahuStep('Could not sync Akahu');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sync Akahu');
    } finally {
      setBusy(false);
    }
  };

  const finishSignup = () => {
    void completeAkahuStep('Could not finish onboarding');
  };

  const catsByType = (t: CategoryType) =>
    categories.filter((c) => normalizeCategoryType(c.type, c.isIncome) === t);
  const wide = step === 'assets' || step === 'budgets' || step === 'connect';

  if (loading || !resumed) {
    return (
      <div className="auth-page">
        <div className="auth-card panel">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`auth-page${step === 'credentials' ? ' register-page' : ''}`}>
      <div className={`auth-card panel${wide ? ' auth-card-wide' : ''}`}>
        <p className="eyebrow">Portfolio Tracker</p>
        {step === 'credentials' ? (
          <>
            <h2>{firstUser ? 'Create your account' : 'Create account'}</h2>
            <p className="page-lead">
              {firstUser ? (
                <>
                  First signup unlocks this local database - existing portfolio and spending data stay
                  on disk and become available under your account. Passwords are hashed (scrypt); never
                  stored in plaintext.
                </>
              ) : (
                <>
                  Create a separate account with its own empty portfolio. You will not see another
                  user&apos;s holdings, banks, or spending. Connect your own banks later if you want.
                </>
              )}
            </p>
            <form className="auth-form" onSubmit={onCredentials}>
              <div className="row gap wrap-row">
                <label className="grow">
                  First name
                  <input
                    type="text"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    maxLength={40}
                    disabled={busy}
                  />
                </label>
                <label className="grow">
                  Last name
                  <input
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    maxLength={40}
                    disabled={busy}
                  />
                </label>
              </div>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  disabled={busy}
                />
              </label>
              <label>
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  disabled={busy}
                />
              </label>
              <p className="auth-hint">At least 8 characters, with a letter and a number.</p>
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Creating…' : 'Continue'}
              </button>
            </form>
            {!firstUser ? (
              <p className="auth-switch">
                Already have an account? <Link to="/login">Sign in</Link>
              </p>
            ) : null}
          </>
        ) : step === 'assets' ? (
          <>
            <h2>Choose asset classes</h2>
            <p className="page-lead">
              Toggle which asset types you want in Portfolio and related views. You can change this
              later in Settings. Disabled classes are hidden (data stays on disk). This step is
              required before you can open the app.
            </p>
            {info ? <p className="auth-info" role="status">{info}</p> : null}
            <form className="auth-form" onSubmit={onAssets}>
              <AssetClassToggles value={prefs} onChange={setPrefs} disabled={busy} />
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save & continue'}
              </button>
            </form>
          </>
        ) : step === 'budgets' ? (
          <>
            <h2>Set budget categories</h2>
            <p className="page-lead">
              Review categories by type for the Spending page and budget plans. Choose type with the
              toggle when adding (spending, income, transfer out, transfer in). Only spending counts
              as Budget spend; transfer in is not income. Required before opening the app — edit
              later in Settings.
            </p>
            <form className="auth-form account-form" onSubmit={onAddCategory}>
              <CategoryTypeToggle
                value={newCatType}
                onChange={setNewCatType}
                disabled={catBusy || busy}
                label="Type (set when creating)"
              />
              <div className="row gap wrap-row" style={{ marginTop: '0.75rem' }}>
                <label className="field grow">
                  <span>New category name</span>
                  <input
                    type="text"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    maxLength={80}
                    placeholder="e.g. Pets"
                    disabled={catBusy || busy}
                  />
                </label>
                <div className="field field-align-end">
                  <span className="sr-only">Add</span>
                  <button
                    type="submit"
                    className="btn ghost"
                    disabled={catBusy || busy || !newCatName.trim()}
                  >
                    {catBusy
                      ? 'Adding…'
                      : `Add ${CATEGORY_TYPE_LABELS[newCatType].toLowerCase()} category`}
                  </button>
                </div>
              </div>
            </form>

            <div className="txn-cat-columns txn-cat-columns-4">
              {CATEGORY_TYPES.map((t) => {
                const rows = catsByType(t);
                return (
                  <div key={t}>
                    <h3>{CATEGORY_TYPE_LABELS[t]}</h3>
                    <ul className="txn-cat-list">
                      {rows.map((c) => (
                        <li key={c.id}>
                          <span>{c.name}</span>
                          <button
                            type="button"
                            className="btn small ghost"
                            disabled={catBusy || busy}
                            onClick={() => void onDeleteCategory(c)}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                      {rows.length === 0 ? (
                        <li className="muted">
                          No {CATEGORY_TYPE_LABELS[t].toLowerCase()} categories.
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              })}
            </div>

            <form className="auth-form" onSubmit={onBudgets}>
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <button
                type="submit"
                className="btn primary"
                disabled={busy || categories.length === 0}
              >
                {busy ? 'Saving…' : 'Save & continue'}
              </button>
            </form>
          </>
        ) : step === 'connect' && offerAkahu ? (
          <>
            <h2>Connect banks & investments</h2>
            <p className="page-lead">
              Connect <em>your</em> NZ banks, Sharesies, Hatch, and KiwiSaver through{' '}
              <strong>Akahu</strong>. This checkpoint keeps setup explicit: you can connect and sync
              now, or choose <strong>Skip / do later</strong> to open an empty portfolio. You can
              connect anytime under <strong>Settings → Connect accounts</strong>.
            </p>
            {info ? <p className="auth-info" role="status">{info}</p> : null}
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <div className="auth-form">
              {akahu?.mode === 'personal' ? (
                <a
                  className="btn primary"
                  href="https://my.akahu.nz"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Akahu
                </a>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void onConnectAkahu()}
                >
                  {busy ? 'Starting…' : 'Connect with Akahu'}
                </button>
              )}
              {akahu?.canSync ? (
                <button type="button" className="btn" disabled={busy} onClick={() => void onSyncAndFinish()}>
                  {busy ? 'Syncing…' : 'Sync & finish'}
                </button>
              ) : null}
              <button type="button" className="btn ghost" disabled={busy} onClick={finishSignup}>
                {firstUser ? 'Skip — open portfolio' : 'Skip / do later'}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
    </div>
  );
}
