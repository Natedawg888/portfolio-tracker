/**
 * Ad rules (KAN-72). Run: npm run test:ads
 */
import {
  ADS_OFF,
  SIDE_ADS_MIN_HEIGHT,
  SIDE_ADS_MIN_WIDTH,
  adPlacement,
  adsConfigFromEnv,
  adsPathAllowed,
  bottomAdSize,
  readAdPersonalisation,
} from './ads.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);
}

const live = {
  ADS_ENABLED: 'true',
  ADSENSE_CLIENT_ID: 'ca-pub-1234567890123456',
  ADSENSE_SLOT_LEFT: '1111111111',
  ADSENSE_SLOT_RIGHT: '2222222222',
  ADSENSE_SLOT_BOTTOM: '3333333333',
};

// Kill switch.
eq(adsConfigFromEnv({}, true), ADS_OFF, 'off by default');
eq(adsConfigFromEnv({ ...live, ADS_ENABLED: 'false' }, true), ADS_OFF, 'ADS_ENABLED=false turns everything off');
eq(adsConfigFromEnv({ ...live, ADS_ENABLED: '' }, true), ADS_OFF, 'empty is off');
eq(adsConfigFromEnv({ ...live, ADS_ENABLED: 'ON' }, true).mode, 'adsense', 'on / true / 1 / yes');

// AdSense.
eq(
  adsConfigFromEnv(live, true),
  { mode: 'adsense', clientId: live.ADSENSE_CLIENT_ID, slots: { left: '1111111111', right: '2222222222', bottom: '3333333333' } },
  'live config',
);
eq(adsConfigFromEnv({ ...live, ADSENSE_SLOT_RIGHT: 'abc' }, true).slots.right, null, 'bad slot id dropped');
eq(adsConfigFromEnv({ ...live, ADSENSE_SLOT_LEFT: '', ADSENSE_SLOT_RIGHT: '', ADSENSE_SLOT_BOTTOM: '' }, true), ADS_OFF, 'no slots = off');
eq(adsConfigFromEnv({ ...live, ADSENSE_CLIENT_ID: 'pub-123"><script>' }, true), ADS_OFF, 'bad client id = off in production');

// Placeholder only outside production.
eq(adsConfigFromEnv({ ADS_ENABLED: '1' }, false).mode, 'placeholder', 'dev placeholder without a client id');
eq(adsConfigFromEnv({ ADS_ENABLED: '1' }, true), ADS_OFF, 'production never shows placeholders');

// Where.
const cfg = adsConfigFromEnv(live, true);
const vp = (width: number, height = 900) => ({ width, height });
eq(adPlacement(cfg, vp(SIDE_ADS_MIN_WIDTH), '/'), 'side', 'wide desktop: side banners');
eq(adPlacement(cfg, vp(SIDE_ADS_MIN_WIDTH - 1), '/'), 'bottom', 'narrower desktop: bottom banner');
eq(adPlacement(cfg, vp(1600, SIDE_ADS_MIN_HEIGHT - 1), '/'), 'bottom', 'short window: bottom banner');
eq(adPlacement(cfg, vp(820), '/spending'), 'bottom', 'tablet');
eq(adPlacement(cfg, vp(390, 844), '/spending'), 'bottom', 'phone');
eq(adPlacement({ ...cfg, slots: { ...cfg.slots, bottom: null } }, vp(390), '/'), null, 'no bottom unit: nothing on phones');
eq(adPlacement({ ...cfg, slots: { left: null, right: null, bottom: '3' } }, vp(1600), '/'), 'bottom', 'only a bottom unit: bottom everywhere');
eq(adPlacement(ADS_OFF, vp(2000), '/'), null, 'kill switch');
eq(adPlacement(null, vp(2000), '/'), null, 'config not loaded yet');
eq(adPlacement(adsConfigFromEnv({ ADS_ENABLED: '1' }, false), vp(390), '/'), 'bottom', 'placeholder on phones');
eq(adPlacement(cfg, vp(390), '/login'), null, 'not on sign-in');
eq(adsPathAllowed('/register'), false, 'not on sign-up');
eq(adsPathAllowed('/i/abc'), false, 'not on shared invoices');
eq(adsPathAllowed('/privacy'), false, 'not on the privacy page');
eq(adsPathAllowed('/paye'), true, 'app pages');

// Bottom sizes.
eq(bottomAdSize(390), { width: 320, height: 50 }, 'phone banner');
eq(bottomAdSize(767), { width: 320, height: 50 }, 'large phone');
eq(bottomAdSize(768), { width: 728, height: 90 }, 'tablet leaderboard');

// Personalisation choice.
const store = (v: string | null) => ({ getItem: () => v });
eq(readAdPersonalisation(store(null)), null, 'not asked');
eq(readAdPersonalisation(store('personalised')), 'personalised', 'opted in');
eq(readAdPersonalisation(store('junk')), null, 'junk ignored');
eq(readAdPersonalisation({ getItem: () => { throw new Error('blocked'); } }), null, 'storage blocked');

console.log('ads rule tests ok');
