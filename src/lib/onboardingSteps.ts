/**
 * The signup steps that apply to this account, for "Step 3 of 3". Creating the account is step 1
 * (also for Google / Apple / Microsoft sign-ups, who skip the password form). Crypto wallets only
 * appear with Crypto turned on, and the Akahu connect step only for the account that is offered it.
 */
export type OnboardingStep = 'credentials' | 'assets' | 'wallets' | 'budgets' | 'connect';

export function onboardingSteps(opts: { crypto: boolean; offerAkahu: boolean }): OnboardingStep[] {
  return [
    'credentials',
    'assets',
    ...(opts.crypto ? (['wallets'] as const) : []),
    'budgets',
    ...(opts.offerAkahu ? (['connect'] as const) : []),
  ];
}

/** "Step 3 of 3", or null for a step outside the list. */
export function stepLabel(step: OnboardingStep, opts: { crypto: boolean; offerAkahu: boolean }): string | null {
  const steps = onboardingSteps(opts);
  const i = steps.indexOf(step);
  return i < 0 ? null : `Step ${i + 1} of ${steps.length}`;
}
