/**
 * Ad banners (KAN-72). Pure rules shared by the API and the app.
 *
 * - Ads are off unless ADS_ENABLED is set (the kill switch; read on every request).
 * - With an AdSense publisher id they are real ads; without one, development shows a
 *   placeholder box and production shows nothing.
 * - Wide desktop windows: one banner each side of the content. Phones, tablets and narrower
 *   windows: one banner fixed to the bottom of the screen. Never on sign-in / sign-up.
 * - Non-personalised by default; personalised only after the user opts in.
 * Plans (KAN-50) are not built yet, so every signed-in user is treated as Free.
 */

export type AdsMode = 'off' | 'adsense' | 'placeholder';

export type AdsConfig = {
  mode: AdsMode;
  /** ca-pub-… publisher id; only when mode is 'adsense'. */
  clientId: string | null;
  /** AdSense ad unit ids; null = that slot stays empty. */
  slots: { left: string | null; right: string | null; bottom: string | null };
};

const NO_SLOTS = { left: null, right: null, bottom: null };
export const ADS_OFF: AdsConfig = { mode: 'off', clientId: null, slots: NO_SLOTS };

/** One 160×600 skyscraper per side. */
export const SIDE_AD = { width: 160, height: 600 } as const;

/**
 * Narrowest window that shows side ads: the 1120px content column plus a 160px
 * banner and gaps on each side, so the content is never squeezed.
 */
export const SIDE_ADS_MIN_WIDTH = 1520;

/** Shortest window that fits the 600px banner with its label and note. */
export const SIDE_ADS_MIN_HEIGHT = 680;

/** Bottom banner: leaderboard on tablets and up, mobile banner on phones. */
export function bottomAdSize(viewportWidth: number): { width: number; height: number } {
  return viewportWidth >= 768 ? { width: 728, height: 90 } : { width: 320, height: 50 };
}

/** Paths where ads never show (also anything outside the signed-in layout). */
const NO_AD_PATHS = [/^\/login\b/, /^\/register\b/, /^\/i\//, /^\/privacy\b/];

const TRUE = new Set(['1', 'true', 'yes', 'on']);

/** Build the config from env. Anything unexpected turns ads off. */
export function adsConfigFromEnv(env: Record<string, string | undefined>, production: boolean): AdsConfig {
  if (!TRUE.has(String(env.ADS_ENABLED ?? '').trim().toLowerCase())) return ADS_OFF;
  const clientId = String(env.ADSENSE_CLIENT_ID ?? '').trim();
  const slot = (v: string | undefined) => (/^\d{6,20}$/.test(String(v ?? '').trim()) ? String(v).trim() : null);
  if (/^ca-pub-\d{10,20}$/.test(clientId)) {
    const slots = { left: slot(env.ADSENSE_SLOT_LEFT), right: slot(env.ADSENSE_SLOT_RIGHT), bottom: slot(env.ADSENSE_SLOT_BOTTOM) };
    if (!slots.left && !slots.right && !slots.bottom) return ADS_OFF;
    return { mode: 'adsense', clientId, slots };
  }
  return production ? ADS_OFF : { mode: 'placeholder', clientId: null, slots: NO_SLOTS };
}

export function adsPathAllowed(pathname: string): boolean {
  return !NO_AD_PATHS.some((re) => re.test(pathname));
}

export type AdPlacement = 'side' | 'bottom';

/** Where ads go for this window, or null for none. */
export function adPlacement(
  config: AdsConfig | null,
  viewport: { width: number; height: number },
  pathname: string,
): AdPlacement | null {
  if (!config || config.mode === 'off' || !adsPathAllowed(pathname)) return null;
  const side = viewport.width >= SIDE_ADS_MIN_WIDTH && viewport.height >= SIDE_ADS_MIN_HEIGHT;
  if (config.mode === 'placeholder') return side ? 'side' : 'bottom';
  if (side && (config.slots.left || config.slots.right)) return 'side';
  return config.slots.bottom ? 'bottom' : null;
}

/** The user's choice; null = not asked yet (ads stay non-personalised). */
export type AdPersonalisation = 'personalised' | 'non_personalised';

export const AD_PREF_KEY = 'pt.adPersonalisation';
export const AD_PREF_EVENT = 'pt:ad-personalisation';

export function readAdPersonalisation(storage: Pick<Storage, 'getItem'> | null): AdPersonalisation | null {
  try {
    const v = storage?.getItem(AD_PREF_KEY);
    return v === 'personalised' || v === 'non_personalised' ? v : null;
  } catch {
    return null;
  }
}

/** Save the choice in this browser and tell open pages (Settings, the prompt). */
export function setAdPersonalisation(v: AdPersonalisation): void {
  try {
    window.localStorage.setItem(AD_PREF_KEY, v);
  } catch {
    /* storage blocked: stays non-personalised */
  }
  window.dispatchEvent(new Event(AD_PREF_EVENT));
}
