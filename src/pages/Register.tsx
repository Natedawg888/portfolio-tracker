import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandLockup } from '../components/BrandLockup';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import { ApiError, api, type AuthUser, type SsoProvider } from '../api/client';
import { ssoStartUrl } from '../lib/sso';
import { AssetClassToggles } from '../components/AssetClassToggles';
import { GoogleButton } from '../components/auth/AuthControls';
import { AddWalletPanel } from '../components/AddWalletPanel';
import {
  defaultAssetClassPrefs,
  type AssetClassPrefs,
} from '../lib/assetClassPrefs';
import { invalidateAfterAkahuLinkChange } from '../lib/pageDataCache';
import {
  akahuConnect,
  akahuStatus,
  akahuSync,
  akahuSyncTransactions,
  type AkahuConnectionStatus,
} from '../api/akahuClient';
import { akahuOnboardingRequiredForEmail } from '../lib/onboardingPrefs';
import { checkoutResume, continueAfterPlan, resolvePaidBusinessReturn, stepFromOnboarding, stepLabel, type OnboardingStep, type PlanContinue } from '../lib/onboardingSteps';
import { USAGE_MODES, type UsageMode } from '../lib/usageMode';
import type { AssetClassPrefKey } from '../lib/assetClassPrefs';

/** Asset classes a Personal signup isn't offered (KAN-131). */
const PERSONAL_HIDDEN_CLASSES: readonly AssetClassPrefKey[] = ['business'];
import { canCheckoutPlan, type BillingInterval, type PaidPlan } from '../lib/billingView';
import {
  ADD_BUSINESS_AFTER_SETUP,
  BUSINESS_ACCOUNT_HREF,
  personalBusinessCheckoutRoute,
  routesPersonalToBusinessAccount,
} from '../lib/accountLinksView';
import { CheckoutPendingNote } from '../components/billing/CheckoutPendingNote';
import { BudgetCategoriesStep } from '../components/onboarding/BudgetCategoriesStep';
import { ChoosePlanStep } from '../components/onboarding/ChoosePlanStep';

type Step = OnboardingStep;

export function Register() {
  const { user, loading, register, status, setUser, refresh } = useAuth();
  const { save: savePrefs, enabled: assetEnabled } = useAssetClassPrefs();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('credentials');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [prefs, setPrefs] = useState<AssetClassPrefs>(() => defaultAssetClassPrefs());
  const [usageMode, setUsageMode] = useState<UsageMode>('personal');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planAction, setPlanAction] = useState<string | null>(null);
  const [paymentPending, setPaymentPending] = useState(false);
  const [runsNote, setRunsNote] = useState(false);
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const midSignupRef = useRef(false);
  /** Set before onboarding flips to complete, so business signup is not sent home instead of setup. */
  const resumeOnce = useRef(false);
  /** Where to go once signup is complete, set before that flag flips so the redirect can read it. */
  const [planExit, setPlanExit] = useState<{ dest: PlanContinue; pending: boolean } | null>(null);
  const [resumed, setResumed] = useState(false);

  const [akahu, setAkahu] = useState<AkahuConnectionStatus | null>(null);
  const [walletsAdded, setWalletsAdded] = useState<string[]>([]);

  /**
   * Business only opens setup when this account can manage a business. Free goes home at once.
   * A paid return waits in the confirming state for the webhook, then opens setup.
   */
  const destinationFor = useCallback(async (dest: PlanContinue, pending: boolean): Promise<PlanContinue> => {
    if (dest.kind !== 'business-setup') return dest;
    if (pending) setPaymentPending(true);
    const kind = await resolvePaidBusinessReturn(pending, async () => (await api.settings.plan()).features.business_manage === true);
    return kind === 'business-setup' ? dest : { kind: 'home' };
  }, []);

  const leaveAfterPlan = useCallback((dest: PlanContinue, pending: boolean) => {
    const state = pending ? { billingPending: true } : undefined;
    if (dest.kind === 'business-setup') {
      midSignupRef.current = false;
      navigate('/business?setup=1', { replace: true, state });
      return;
    }
    if (dest.kind === 'home') {
      midSignupRef.current = false;
      navigate('/', { replace: true, state });
      return;
    }
    setStep(dest.step);
  }, [navigate]);

  /** Free, Skip, or a successful Checkout: record the step and continue signup. */
  const finishPlan = useCallback(async (current: AuthUser, pending: boolean, action: string | null, runsBusiness?: boolean) => {
    const chosen = continueAfterPlan({
      ...current,
      onboarding: { ...current.onboarding, planStepDone: true },
    });
    if (action) setPlanAction(action);
    setError(null);
    try {
      if (typeof runsBusiness === 'boolean') {
        await api.settings.setRunsBusiness(runsBusiness);
        if (runsBusiness && !pending) setRunsNote(true);
      }
      const dest = await destinationFor(chosen, pending);
      setPlanExit(dest.kind === 'step' ? null : { dest, pending });
      let nextUser = current;
      if (current.onboarding.planStepDone === false) {
        const r = await api.settings.setOnboarding({ planStepDone: true });
        nextUser = { ...current, onboardingComplete: r.onboardingComplete, onboarding: r.onboarding };
        setUser(nextUser);
      }
      await refresh();
      leaveAfterPlan(dest, pending);
    } catch (err) {
      setPlanExit(null);
      setPaymentPending(false);
      setStep('plan');
      setError(err instanceof ApiError ? err.message : 'Could not save your plan choice');
    } finally {
      setPlanAction(null);
    }
  }, [destinationFor, leaveAfterPlan, refresh, setUser]);

  // Resume incomplete onboarding after refresh / login redirect, including a return from Stripe.
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
    if (resumeOnce.current) return;
    resumeOnce.current = true;
    const flag = searchParams.get('billing');
    const resume = checkoutResume(flag, user.onboarding.planStepDone);
    if (flag === 'success' || flag === 'cancelled') {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('billing');
      setSearchParams(nextParams, { replace: true });
    }
    if (resume.action === 'stay') {
      setInfo('Checkout cancelled. No charge was made.');
      setStep('plan');
      midSignupRef.current = true;
      setResumed(true);
      return;
    }
    if (resume.action === 'finish') {
      setStep('plan');
      setPaymentPending(true);
      midSignupRef.current = true;
      setResumed(true);
      void finishPlan(user, true, null);
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
  }, [loading, user, resumed, searchParams, setSearchParams, finishPlan]);

  useEffect(() => {
    let cancelled = false;
    api.auth
      .ssoProviders()
      .then((r) => {
        if (!cancelled) setProviders(r.providers);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (planExit?.dest.kind === 'business-setup') {
      return <Navigate to="/business?setup=1" replace state={planExit.pending ? { billingPending: true } : undefined} />;
    }
    return <Navigate to="/" replace state={planExit?.pending ? { billingPending: true } : undefined} />;
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
    setStep('usage');
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

  /** Save what the account is for. Business only skips the personal steps. A new account still chooses a plan first. */
  const onUsage = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    midSignupRef.current = true;
    try {
      const r = await api.settings.setUsageMode(usageMode);
      const planAlreadyDone = r.onboarding.planStepDone !== false;
      const exit = usageMode === 'business' && planAlreadyDone ? await destinationFor({ kind: 'business-setup' }, false) : null;
      if (exit) setPlanExit({ dest: exit, pending: false });
      if (user) setUser({ ...user, usageMode: r.usageMode, usageModeChosen: true, onboardingComplete: r.onboardingComplete, onboarding: r.onboarding });
      await refresh();
      if (exit) {
        midSignupRef.current = false;
        leaveAfterPlan(exit, false);
        return;
      }
      setStep('plan');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your choice');
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
      // Personal accounts aren't offered Businesses (KAN-131), so it's saved off.
      await savePrefs(stepMode === 'personal' ? { ...prefs, business: false } : prefs);
      await refresh();
      // Optional wallet step only when Crypto is turned on.
      setStep(prefs.crypto ? 'wallets' : 'budgets');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save asset preferences');
    } finally {
      setBusy(false);
    }
  };

  /** The categories are saved; mark the step done and move on. Errors go back to the step. */
  const onBudgets = async () => {
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
              : 'Akahu OAuth is not configured yet. You can skip this optional step.',
        );
        return;
      }
      const r = await akahuConnect();
      if (r.authorizeUrl) {
        invalidateAfterAkahuLinkChange();
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
        setInfo('Akahu is not connected for this account. Use “Skip / do later”.');
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

  const onPlanPaid = async (plan: PaidPlan, interval: BillingInterval, runsBusiness: boolean) => {
    if (!canCheckoutPlan(plan)) {
      setError('Pro is not available yet.');
      return;
    }
    const personalBusiness = personalBusinessCheckoutRoute({
      usage: user?.usageModeChosen ? user.usageMode : usageMode,
      plan,
      onboardingComplete: user?.onboardingComplete === true,
    });
    if (personalBusiness === 'settings') {
      window.location.assign(BUSINESS_ACCOUNT_HREF);
      return;
    }
    if (personalBusiness === 'later') {
      setError(null);
      setInfo(ADD_BUSINESS_AFTER_SETUP);
      setPlanAction(null);
      return;
    }
    setError(null);
    setInfo(null);
    setPlanAction(plan);
    try {
      await api.settings.setRunsBusiness(runsBusiness);
      const { url } = await api.billing.checkout(plan, interval, '/register');
      window.location.assign(url);
    } catch (err) {
      if (err instanceof ApiError && routesPersonalToBusinessAccount(err.code)) {
        if (user?.onboardingComplete) window.location.assign(BUSINESS_ACCOUNT_HREF);
        else {
          setError(null);
          setInfo(ADD_BUSINESS_AFTER_SETUP);
          setPlanAction(null);
        }
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Couldn’t open checkout. Try again in a minute.');
      setPlanAction(null);
    }
  };

  // Crypto adds the wallets step: the choice on the asset step, the saved preference after it.
  // The plan step is counted for every mode, including Business only.
  const stepMode = step === 'usage' ? usageMode : (user?.usageMode ?? usageMode);
  const stepText =
    step === 'credentials' ? null : stepLabel(step, { crypto: step === 'assets' ? prefs.crypto : assetEnabled('crypto'), offerAkahu, mode: stepMode });
  const wide = step === 'usage' || step === 'plan' || step === 'assets' || step === 'wallets' || step === 'budgets' || step === 'connect';

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
    <div className={`auth-page${step === 'credentials' ? ' register-page' : ' assets-page'}${step === 'plan' ? ' plan-page' : ''}`}>
      <div className={`auth-card panel${wide ? ' auth-card-wide' : ''}${step === 'plan' ? ' auth-card-plans' : ''}`}>
        <div className="auth-brand">
          <Link to="/" className="auth-brand-link" aria-label="KoruLedger home">
            <BrandLockup size="md" />
          </Link>
        </div>
        {stepText ? <p className="onboarding-step">{stepText}</p> : null}
        {paymentPending ? <CheckoutPendingNote active /> : null}
        {runsNote ? (
          <p className="billing-test-note small" role="note">
            Business management needs Plus or Business. You can choose a plan later in Settings.
          </p>
        ) : null}
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
            {/* New Google / Apple / Microsoft users come back to /register and resume the next open step. */}
            {!firstUser && providers.length > 0 ? (
              <div className="sso-buttons">
                <p className="sso-divider muted small">or</p>
                {providers.map((p) =>
                  p.id === 'google' ? (
                    <GoogleButton key={p.id} href={ssoStartUrl(p.id)} text="Sign up with Google" />
                  ) : (
                    <a key={p.id} className={`btn ghost sso-btn sso-btn--${p.id}`} href={ssoStartUrl(p.id)}>
                      Sign up with {p.label}
                    </a>
                  ),
                )}
              </div>
            ) : null}
            <p className="auth-hint auth-legal">
              By creating an account you agree to the <Link to="/terms">terms of use</Link> and acknowledge the{' '}
              <Link to="/privacy">privacy policy</Link>.
            </p>
            {!firstUser ? (
              <p className="auth-switch">
                Already have an account? <Link to="/login">Sign in</Link>
              </p>
            ) : null}
          </>
        ) : step === 'usage' ? (
          <>
            <h2>What will you use KoruLedger for?</h2>
            <p className="page-lead">
              Sets the menu and your home page. Business only hides the personal pages from the menu; their data is kept and they still open by address.
            </p>
            {info ? <p className="auth-info" role="status">{info}</p> : null}
            <form className="auth-form" onSubmit={onUsage}>
              <fieldset className="usage-mode-choices">
                <legend className="sr-only">What will you use KoruLedger for?</legend>
                {USAGE_MODES.map((m) => (
                  <label key={m.value} className={`usage-mode-choice${usageMode === m.value ? ' active' : ''}`}>
                    <input type="radio" name="usage-mode" value={m.value} checked={usageMode === m.value} disabled={busy} onChange={() => setUsageMode(m.value)} />
                    <span className="usage-mode-text">
                      <strong>{m.label}</strong>
                      <span className="muted small">{m.blurb}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : usageMode === 'business' ? 'Continue to business setup' : 'Continue'}
              </button>
            </form>
          </>
        ) : step === 'plan' && user ? (
          <>
            {info ? <p className="auth-info" role="status">{info}</p> : null}
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <ChoosePlanStep
              usage={stepMode}
              busy={planAction}
              onFree={(runsBusiness) => void finishPlan(user, false, 'free', runsBusiness)}
              onSkip={(runsBusiness) => void finishPlan(user, false, 'skip', runsBusiness)}
              onPaid={(plan, interval, runsBusiness) => void onPlanPaid(plan, interval, runsBusiness)}
            />
          </>
        ) : step === 'assets' ? (
          <>
            <h2>Choose asset classes</h2>
            <p className="page-lead">
              Toggle which asset types you want in Portfolio and related views. You can change this
              later in the account menu → Settings. Disabled classes are hidden (data stays on disk). This step is
              required before you can open the app.
            </p>
            {info ? <p className="auth-info" role="status">{info}</p> : null}
            <form className="auth-form" onSubmit={onAssets}>
              <AssetClassToggles value={prefs} onChange={setPrefs} disabled={busy} hiddenKeys={stepMode === 'personal' ? PERSONAL_HIDDEN_CLASSES : undefined} />
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save & continue'}
              </button>
            </form>
          </>
        ) : step === 'wallets' ? (
          <>
            <h2>Connect crypto wallets</h2>
            <p className="page-lead">
              Add the public address of any wallet you want tracked in Portfolio. This step is
              optional — you can add or remove wallets later in Portfolio → Crypto.
            </p>
            {walletsAdded.length > 0 ? (
              <p className="auth-info" role="status">
                Added: {walletsAdded.join(', ')}
              </p>
            ) : null}
            <AddWalletPanel
              onAdded={(w) => setWalletsAdded((names) => [...names, w.name])}
              onSkip={() => {
                setError(null);
                setStep('budgets');
              }}
              skipLabel={walletsAdded.length > 0 ? 'Continue' : 'Skip for now'}
            />
          </>
        ) : step === 'budgets' ? (
          <>
            <h2>Pick your budget categories</h2>
            <p className="page-lead">
              We’ve started you with common ones. Untick any you don’t need. You can change these any time in Settings.
            </p>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            {user ? <BudgetCategoriesStep userId={user.id} onDone={onBudgets} /> : null}
          </>
        ) : step === 'connect' && offerAkahu ? (
          <>
            <h2>Connect banks & investments</h2>
            <p className="page-lead">
              Connect <em>your</em> NZ banks, Sharesies, Hatch, and KiwiSaver through{' '}
              <strong>Akahu</strong>. This checkpoint keeps setup explicit: you can connect and sync
              now, or choose <strong>Skip / do later</strong> to open an empty portfolio.
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
