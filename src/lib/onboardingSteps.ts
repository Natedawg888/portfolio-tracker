/**
 * The signup steps that apply to this account, for "Step 3 of 4". Creating the account is step 1
 * (also for Google / Apple / Microsoft sign-ups, who skip the password form). Step 2 asks what
 * the account is for (KAN-124). Personal and Both then set up asset classes, crypto wallets
 * (only with Crypto turned on), budget categories and, for the account that is offered it,
 * Akahu. Business only skips those personal steps and ends at setting up the first business.
 */
import type { UsageMode } from './usageMode.ts';

export type OnboardingStep = 'credentials' | 'usage' | 'assets' | 'wallets' | 'budgets' | 'connect' | 'business';

export type StepOptions = { crypto: boolean; offerAkahu: boolean; mode?: UsageMode };

export function onboardingSteps(opts: StepOptions): OnboardingStep[] {
  if (opts.mode === 'business') return ['credentials', 'usage', 'business'];
  return [
    'credentials',
    'usage',
    'assets',
    ...(opts.crypto ? (['wallets'] as const) : []),
    'budgets',
    ...(opts.offerAkahu ? (['connect'] as const) : []),
  ];
}

/** "Step 3 of 4", or null for a step outside the list. */
export function stepLabel(step: OnboardingStep, opts: StepOptions): string | null {
  const steps = onboardingSteps(opts);
  const i = steps.indexOf(step);
  return i < 0 ? null : `Step ${i + 1} of ${steps.length}`;
}
