/**
 * The signup steps that apply to this account, for "Step 3 of 5". Creating the account is step 1
 * (also for Google / Apple / Microsoft sign-ups, who skip the password form). Step 2 asks what
 * the account is for (KAN-124). Step 3 chooses a plan (Free, or Plus / Business through Stripe).
 * Personal and Both then set up asset classes, crypto wallets (only with Crypto turned on),
 * budget categories and, for the account that is offered it, Akahu. Business only skips those
 * personal steps and ends at setting up the first business.
 */
import { akahuOnboardingRequiredForEmail } from './onboardingPrefs.ts';
import type { UsageMode } from './usageMode.ts';

export type OnboardingStep = 'credentials' | 'usage' | 'plan' | 'assets' | 'wallets' | 'budgets' | 'connect' | 'business';

export type StepOptions = { crypto: boolean; offerAkahu: boolean; mode?: UsageMode };

export function onboardingSteps(opts: StepOptions): OnboardingStep[] {
  if (opts.mode === 'business') return ['credentials', 'usage', 'plan', 'business'];
  return [
    'credentials',
    'usage',
    'plan',
    'assets',
    ...(opts.crypto ? (['wallets'] as const) : []),
    'budgets',
    ...(opts.offerAkahu ? (['connect'] as const) : []),
  ];
}

/** "Step 3 of 5", or null for a step outside the list. */
export function stepLabel(step: OnboardingStep, opts: StepOptions): string | null {
  const steps = onboardingSteps(opts);
  const i = steps.indexOf(step);
  return i < 0 ? null : `Step ${i + 1} of ${steps.length}`;
}

/** Enough of the signed-in user to decide which signup step is still open. */
export type OnboardingProgress = {
  email?: string | null;
  onboardingComplete: boolean;
  usageModeChosen: boolean;
  usageMode?: UsageMode;
  onboarding: {
    assetClassesDone: boolean;
    budgetCategoriesDone: boolean;
    akahuStepDone: boolean;
    /** False while the new account has not chosen or skipped a plan. Missing counts as done. */
    planStepDone?: boolean;
  };
};

/**
 * The step still open, or `done` when signup can leave /register.
 * A missing `planStepDone` (accounts from before the step) does not reopen it.
 * Business only, once a plan is chosen, is `done` here — the page sends them to set up the business.
 */
export function stepFromOnboarding(user: OnboardingProgress): OnboardingStep | 'done' {
  if (user.onboardingComplete) return 'done';
  if (!user.usageModeChosen) return 'usage';
  if (user.onboarding.planStepDone === false) return 'plan';
  if (user.usageMode === 'business') return 'done';
  if (!user.onboarding.assetClassesDone) return 'assets';
  if (!user.onboarding.budgetCategoriesDone) return 'budgets';
  if (!akahuOnboardingRequiredForEmail(user.email) || user.onboarding.akahuStepDone) return 'done';
  return 'connect';
}

export type PlanContinue = { kind: 'step'; step: OnboardingStep } | { kind: 'business-setup' } | { kind: 'home' };

/**
 * Where ?setup=1 goes. Free (no business management) does not open the add form.
 * A business that already exists, including the starter one, is edited instead of created again.
 */
export function businessSetupTarget(
  canManage: boolean,
  businesses: readonly { id: string; isDefault?: boolean }[],
): { kind: 'home' } | { kind: 'edit'; id: string } | { kind: 'create' } {
  if (!canManage) return { kind: 'home' };
  const existing = businesses.find((b) => b.isDefault) ?? businesses[0];
  if (existing) return { kind: 'edit', id: existing.id };
  return { kind: 'create' };
}

/** Delays before each plan check while a paid business signup waits for the webhook. The first check is immediate. */
export const PAID_BUSINESS_RETURN_WAITS_MS = [0, 800, 1600] as const;

/**
 * Business-only signup after Checkout. Free goes home at once. A paid return polls briefly
 * while payment is confirming, then opens business setup once business management is on.
 */
export async function resolvePaidBusinessReturn(
  pending: boolean,
  probe: () => Promise<boolean>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<'business-setup' | 'home'> {
  const waits = pending ? PAID_BUSINESS_RETURN_WAITS_MS : ([0] as const);
  for (const ms of waits) {
    if (ms > 0) await wait(ms);
    try {
      if (await probe()) return 'business-setup';
    } catch {
      /* A failed read keeps waiting only while payment is still confirming. */
    }
    if (!pending) return 'home';
  }
  return 'home';
}

/** Where Free, Skip, or a successful Checkout goes next. */
export function continueAfterPlan(user: OnboardingProgress): PlanContinue {
  if ((user.usageMode ?? 'personal') === 'business') return { kind: 'business-setup' };
  const step = stepFromOnboarding({
    ...user,
    onboardingComplete: false,
    onboarding: { ...user.onboarding, planStepDone: true },
  });
  if (step === 'done') return { kind: 'home' };
  return { kind: 'step', step };
}

/**
 * Coming back from Stripe Checkout during signup.
 * Success finishes the plan step and continues (the plan itself follows the webhook).
 * Cancel leaves the step open so they can choose again or skip.
 */
export function checkoutResume(
  billing: string | null,
  planStepDone: boolean | undefined,
): { action: 'stay' } | { action: 'finish'; pending: true } | { action: 'none' } {
  if (billing === 'cancelled') return planStepDone === false ? { action: 'stay' } : { action: 'none' };
  if (billing === 'success') return { action: 'finish', pending: true };
  return { action: 'none' };
}
