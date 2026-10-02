/**
 * Signup onboarding flags stored in users.preferences_json.onboarding.
 *
 * Legacy users (no `onboarding` key) are treated as complete so existing
 * accounts are not locked out of the dashboard. New and in-progress users
 * must pass through asset classes, budget categories, and the Akahu step.
 */

export type OnboardingFlags = {
  assetClassesDone: boolean;
  budgetCategoriesDone: boolean;
  /** The Akahu step was explicitly completed or skipped. */
  akahuStepDone: boolean;
};

export type ParsedOnboarding = {
  /** null = legacy user (no onboarding block) → treated complete */
  flags: OnboardingFlags | null;
  complete: boolean;
};

export function defaultIncompleteOnboarding(): OnboardingFlags {
  return { assetClassesDone: false, budgetCategoriesDone: false, akahuStepDone: false };
}

export function parseOnboardingFromPreferencesJson(
  preferencesJson: string | null | undefined,
): ParsedOnboarding {
  if (preferencesJson == null || String(preferencesJson).trim() === '') {
    return { flags: null, complete: true };
  }
  try {
    const parsed = JSON.parse(String(preferencesJson)) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return { flags: null, complete: true };
    if (!('onboarding' in parsed)) return { flags: null, complete: true };
    const raw = parsed.onboarding;
    if (!raw || typeof raw !== 'object') {
      return { flags: defaultIncompleteOnboarding(), complete: false };
    }
    const o = raw as Record<string, unknown>;
    const flags: OnboardingFlags = {
      assetClassesDone: o.assetClassesDone === true,
      budgetCategoriesDone: o.budgetCategoriesDone === true,
      akahuStepDone: o.akahuStepDone === true,
    };
    return {
      flags,
      complete: flags.assetClassesDone && flags.budgetCategoriesDone && flags.akahuStepDone,
    };
  } catch {
    return { flags: null, complete: true };
  }
}

/** Initial preferences_json for a brand-new account (must finish setup). */
export function initialPreferencesJsonForNewUser(): string {
  return JSON.stringify({
    onboarding: defaultIncompleteOnboarding(),
  });
}

export function mergeOnboardingIntoPreferencesJson(
  preferencesJson: string | null | undefined,
  patch: Partial<OnboardingFlags>,
): string {
  let existing: Record<string, unknown> = {};
  if (preferencesJson) {
    try {
      const parsed = JSON.parse(preferencesJson);
      if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const prev =
    existing.onboarding && typeof existing.onboarding === 'object'
      ? (existing.onboarding as Record<string, unknown>)
      : {};
  const nextFlags: OnboardingFlags = {
    assetClassesDone:
      patch.assetClassesDone !== undefined
        ? patch.assetClassesDone
        : prev.assetClassesDone === true,
    budgetCategoriesDone:
      patch.budgetCategoriesDone !== undefined
        ? patch.budgetCategoriesDone
        : prev.budgetCategoriesDone === true,
    akahuStepDone:
      patch.akahuStepDone !== undefined
        ? patch.akahuStepDone
        : prev.akahuStepDone === true,
  };
  return JSON.stringify({ ...existing, onboarding: nextFlags });
}
