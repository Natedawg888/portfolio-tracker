/**
 * Signup onboarding flags stored in users.preferences_json.onboarding.
 *
 * Legacy users (no `onboarding` key) are treated as complete so existing
 * accounts are not locked out of the dashboard. New and in-progress users
 * must pass through asset classes and budget categories.
 *
 * The Akahu connect step is offered only to Nathan McCormick
 * (mccormicknathan09@gmail.com). Every other account is stored as if they
 * chose Skip / do later (`akahuStepDone`), including when they sign in later
 * with that step still open. Identification is by email, not user id.
 */

/** Only this account is asked to connect Akahu during signup / onboarding. */
export const AKAHU_SETUP_EMAIL = 'mccormicknathan09@gmail.com';

export type OnboardingFlags = {
  assetClassesDone: boolean;
  budgetCategoriesDone: boolean;
  /** The Akahu step was explicitly completed or skipped. */
  akahuStepDone: boolean;
};

/** True only for Nathan's account — everyone else auto-skips Akahu setup. */
export function akahuOnboardingRequiredForEmail(email: string | null | undefined): boolean {
  return String(email ?? '').trim().toLowerCase() === AKAHU_SETUP_EMAIL;
}

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

/**
 * Initial preferences_json for a brand-new account (must finish setup).
 * Non-Nathan accounts start with the Akahu step already skipped.
 */
export function initialPreferencesJsonForNewUser(email?: string | null): string {
  const onboarding = defaultIncompleteOnboarding();
  if (!akahuOnboardingRequiredForEmail(email)) {
    onboarding.akahuStepDone = true;
  }
  return JSON.stringify({ onboarding });
}

/**
 * Persist the same outcome as "Skip / do later" for every account except Nathan.
 * Legacy rows (no onboarding block) are left untouched — they are already complete.
 * Returns `changed: false` when the stored JSON should stay as-is.
 */
export function preferencesWithAkahuSkippedUnlessRequired(
  preferencesJson: string | null | undefined,
  email: string | null | undefined,
): { json: string | null; changed: boolean } {
  if (akahuOnboardingRequiredForEmail(email)) {
    return { json: preferencesJson ?? null, changed: false };
  }
  const parsed = parseOnboardingFromPreferencesJson(preferencesJson);
  if (!parsed.flags || parsed.flags.akahuStepDone) {
    return { json: preferencesJson ?? null, changed: false };
  }
  return {
    json: mergeOnboardingIntoPreferencesJson(preferencesJson, { akahuStepDone: true }),
    changed: true,
  };
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
