/**
 * What the account uses KoruLedger for (KAN-105): users.preferences_json.usageMode.
 *   personal  today's app (the default, and what every account with no saved value gets)
 *   business  "Business only": a business-first app; personal pages leave the nav but stay
 *             reachable by URL with their data
 *   both      personal and business, with Business next to Dashboard
 * Any plan can choose a mode; reports, GST and the accountant export are gated separately.
 */
export const USAGE_MODES = [
  { value: 'personal', label: 'Personal', blurb: 'Budget, savings, investments, KiwiSaver and take-home pay.' },
  { value: 'business', label: 'Business only', blurb: 'Invoices, clients, employees, income and expenses, GST and year-end figures.' },
  { value: 'both', label: 'Both', blurb: 'Your personal money and your business, side by side.' },
] as const;
export type UsageMode = (typeof USAGE_MODES)[number]['value'];

export function isUsageMode(v: unknown): v is UsageMode {
  return v === 'personal' || v === 'business' || v === 'both';
}

/** The saved mode, and whether one was ever chosen (signup asks when it wasn't). */
export function parseUsageMode(preferencesJson: string | null | undefined): { mode: UsageMode; chosen: boolean } {
  if (preferencesJson == null || String(preferencesJson).trim() === '') return { mode: 'personal', chosen: false };
  try {
    const parsed = JSON.parse(String(preferencesJson)) as Record<string, unknown> | null;
    const raw = parsed && typeof parsed === 'object' ? parsed.usageMode : undefined;
    return isUsageMode(raw) ? { mode: raw, chosen: true } : { mode: 'personal', chosen: false };
  } catch {
    return { mode: 'personal', chosen: false };
  }
}

/** preferences_json with usageMode set; every other key is kept. */
export function mergeUsageModeIntoPreferencesJson(preferencesJson: string | null | undefined, mode: UsageMode): string {
  let existing: Record<string, unknown> = {};
  if (preferencesJson) {
    try {
      const parsed = JSON.parse(preferencesJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  return JSON.stringify({ ...existing, usageMode: mode });
}

/** Every main-nav link, by key. Layout maps each key to its route and label. */
export type NavKey =
  | 'dashboard'
  | 'budget'
  | 'debts'
  | 'portfolio'
  | 'projections'
  | 'news'
  | 'kiwisaver'
  | 'paye'
  | 'business'
  | 'invoices'
  | 'clients'
  | 'calendar'
  | 'history'
  | 'valueSearch';

/** Today's nav. */
const PERSONAL_NAV: NavKey[] = ['dashboard', 'budget', 'debts', 'portfolio', 'projections', 'news', 'kiwisaver', 'paye', 'business', 'calendar', 'history', 'valueSearch'];
/** Business only: the business pages and the Calendar (client meetings). Personal pages leave the nav. */
const BUSINESS_NAV: NavKey[] = ['business', 'invoices', 'clients', 'calendar'];
/** Both: today's nav with Business straight after Dashboard. */
const BOTH_NAV: NavKey[] = ['dashboard', 'business', ...PERSONAL_NAV.filter((k) => k !== 'dashboard' && k !== 'business')];

/** The main nav for a mode, in order (before per-link visibility rules such as KiwiSaver). */
export function navKeysForMode(mode: UsageMode): NavKey[] {
  return mode === 'business' ? BUSINESS_NAV : mode === 'both' ? BOTH_NAV : PERSONAL_NAV;
}

/** Where "/" goes: business mode lands on the business dashboard. */
export function homePathForMode(mode: UsageMode): string {
  return mode === 'business' ? '/business' : '/';
}
