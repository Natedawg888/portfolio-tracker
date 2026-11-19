/**
 * Signup step order, including Choose your plan, and where a Stripe return leaves the user.
 * Run: npm run test:billing
 */
import { AKAHU_SETUP_EMAIL } from './onboardingPrefs.ts';
import { businessSetupTarget, checkoutResume, continueAfterPlan, onboardingSteps, resolvePaidBusinessReturn, stepFromOnboarding, stepLabel, type OnboardingProgress } from './onboardingSteps.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

const base = (over: Partial<OnboardingProgress> = {}): OnboardingProgress => ({
  email: 'new.user@example.com',
  onboardingComplete: false,
  usageModeChosen: true,
  usageMode: 'personal',
  onboarding: { assetClassesDone: false, budgetCategoriesDone: false, akahuStepDone: true, planStepDone: false },
  ...over,
});

eq(onboardingSteps({ crypto: false, offerAkahu: false }).join(), 'credentials,usage,plan,assets,budgets', 'personal steps include the plan');
eq(onboardingSteps({ crypto: true, offerAkahu: true }).join(), 'credentials,usage,plan,assets,wallets,budgets,connect', 'crypto and Akahu add their steps');
eq(onboardingSteps({ crypto: true, offerAkahu: true, mode: 'business' }).join(), 'credentials,usage,plan,business', 'business only still chooses a plan');
eq(stepLabel('plan', { crypto: false, offerAkahu: false }), 'Step 3 of 5', 'plan is step 3 for personal');
eq(stepLabel('plan', { crypto: false, offerAkahu: false, mode: 'business' }), 'Step 3 of 4', 'plan is step 3 for business only');
eq(stepLabel('budgets', { crypto: false, offerAkahu: false }), 'Step 5 of 5', 'budgets is last without crypto or Akahu');
eq(stepLabel('assets', { crypto: false, offerAkahu: false, mode: 'business' }), null, 'business only has no asset step');

eq(stepFromOnboarding(base({ usageModeChosen: false })), 'usage', 'what the account is for comes before the plan');
eq(stepFromOnboarding(base()), 'plan', 'a new account chooses a plan before asset classes');
eq(stepFromOnboarding(base({ usageMode: 'business' })), 'plan', 'business only still stops on the plan');
eq(
  stepFromOnboarding(base({ onboarding: { assetClassesDone: false, budgetCategoriesDone: false, akahuStepDone: true, planStepDone: true } })),
  'assets',
  'after a plan, personal setup continues',
);
eq(
  stepFromOnboarding(base({ usageMode: 'business', onboarding: { assetClassesDone: true, budgetCategoriesDone: true, akahuStepDone: true, planStepDone: true } })),
  'done',
  'business only is finished once a plan is chosen',
);
eq(
  stepFromOnboarding(base({ onboarding: { assetClassesDone: false, budgetCategoriesDone: false, akahuStepDone: true } })),
  'assets',
  'a missing plan flag (older account) does not reopen the step',
);
eq(stepFromOnboarding(base({ onboardingComplete: true })), 'done', 'a finished account is not sent back');
eq(
  stepFromOnboarding(base({
    email: AKAHU_SETUP_EMAIL,
    onboarding: { assetClassesDone: true, budgetCategoriesDone: true, akahuStepDone: false, planStepDone: true },
  })),
  'connect',
  'Nathan still reaches Akahu after the plan',
);
eq(
  stepFromOnboarding(base({
    onboarding: { assetClassesDone: true, budgetCategoriesDone: true, akahuStepDone: true, planStepDone: true },
  })),
  'done',
  'everyone else is done after budgets',
);

eq(continueAfterPlan(base()), { kind: 'step', step: 'assets' }, 'Free continues to asset classes');
eq(continueAfterPlan(base({ usageMode: 'both' })), { kind: 'step', step: 'assets' }, 'Both keeps the personal steps');
eq(continueAfterPlan(base({ usageMode: 'business' })), { kind: 'business-setup' }, 'Business only goes to set up the business');
eq(
  continueAfterPlan(base({ onboarding: { assetClassesDone: true, budgetCategoriesDone: true, akahuStepDone: true, planStepDone: false } })),
  { kind: 'home' },
  'when the later steps are already done, the plan choice opens the app',
);

eq(businessSetupTarget(false, []), { kind: 'home' }, 'Free business signup does not open the add form');
eq(businessSetupTarget(false, [{ id: 'biz' }]), { kind: 'home' }, 'Free with a business still does not open the form');
eq(businessSetupTarget(true, []), { kind: 'create' }, 'a plan that can manage and has none opens the form');
eq(businessSetupTarget(true, [{ id: 'starter', isDefault: true }, { id: 'other' }]), { kind: 'edit', id: 'starter' }, 'an existing starter is edited, not created again');
eq(businessSetupTarget(true, [{ id: 'only' }]), { kind: 'edit', id: 'only' }, 'the only business is the one opened');

{
  const waits: number[] = [];
  let probes = 0;
  const home = await resolvePaidBusinessReturn(false, async () => {
    probes += 1;
    return false;
  }, async (ms) => {
    waits.push(ms);
  });
  eq(home, 'home', 'Free business signup does not wait for a webhook');
  eq(probes, 1, 'Free checks the plan once');
  eq(waits.length, 0, 'Free does not delay');
}
{
  const waits: number[] = [];
  let probes = 0;
  const setup = await resolvePaidBusinessReturn(true, async () => {
    probes += 1;
    return probes >= 2;
  }, async (ms) => {
    waits.push(ms);
  });
  eq(setup, 'business-setup', 'a paid return opens setup once the webhook confirms');
  eq(probes, 2, 'it checks again after the first miss');
  eq(waits, [800], 'the confirming wait is the first delay only');
}
{
  let probes = 0;
  const home = await resolvePaidBusinessReturn(true, async () => {
    probes += 1;
    return false;
  }, async () => {});
  eq(home, 'home', 'a paid return that never confirms goes home after the brief wait');
  eq(probes, 4, 'it polls four times');
}

eq(checkoutResume(null, false), { action: 'none' }, 'no billing flag changes nothing');
eq(checkoutResume('success', false), { action: 'finish', pending: true }, 'success finishes the step and shows payment confirming');
eq(checkoutResume('success', true), { action: 'finish', pending: true }, 'success still confirms when the step was already saved');
eq(checkoutResume('cancelled', false), { action: 'stay' }, 'cancel leaves the plan step open');
eq(checkoutResume('cancelled', true), { action: 'none' }, 'cancel after the step was saved does not rewind');
eq(checkoutResume('https://evil.test', false), { action: 'none' }, 'an unexpected billing flag is ignored');

console.log('onboarding steps: ok');
