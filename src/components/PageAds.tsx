/**
 * Ad banners (KAN-72).
 *   Wide desktop windows: one 160×600 banner each side of the content.
 *   Phones, tablets and narrower windows: one banner fixed to the bottom of the screen
 *   (320×50 on phones, 728×90 from 768px), with space kept at the end of the page for it.
 *
 * - Config comes from /api/ads/config (kill switch + AdSense ids). Off = nothing rendered,
 *   no script loaded.
 * - The AdSense script loads after first paint, once, and only when a slot is shown.
 * - Ads are non-personalised unless the user opted in, and get the site root as their
 *   page URL so no page content (amounts, payees, …) is used for targeting.
 * - Slots are fixed in place, so loading never moves the page. Blocked or unfilled slots
 *   are removed, leaving no empty boxes.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { loadAdsConfig } from '../lib/adsConfig';
import {
  SIDE_AD,
  adPlacement,
  bottomAdSize,
  readAdPersonalisation,
  setAdPersonalisation,
  type AdPersonalisation,
  type AdsConfig,
} from '../lib/ads';

type AdsWindow = Window & {
  adsbygoogle?: unknown[] & { requestNonPersonalizedAds?: number };
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

let scriptPromise: Promise<boolean> | null = null;
/** Load adsbygoogle.js once. Resolves false when blocked (ad blocker, offline, CSP). */
function loadAdSense(clientId: string): Promise<boolean> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<boolean>((resolve) => {
    const w = window as AdsWindow;
    w.adsbygoogle = w.adsbygoogle || [];
    // Must be set before the first ad request; a changed choice applies on the next page load.
    w.adsbygoogle.requestNonPersonalizedAds = readAdPersonalisation(window.localStorage) === 'personalised' ? 0 : 1;
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
    const timer = window.setTimeout(() => resolve(false), 15_000);
    s.onload = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    s.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** After first paint and when the browser is idle, so ads never delay the page. */
function afterFirstPaint(cb: () => void): () => void {
  const w = window as AdsWindow;
  let cancelled = false;
  let idle = 0;
  const raf = window.requestAnimationFrame(() => {
    const run = () => !cancelled && cb();
    if (typeof w.requestIdleCallback === 'function') idle = w.requestIdleCallback(run, { timeout: 3000 });
    else idle = window.setTimeout(run, 1000);
  });
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(raf);
    window.clearTimeout(idle);
  };
}

function useViewport(): { width: number; height: number } {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => setVp(read()));
    };
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.cancelAnimationFrame(raf);
    };
  }, []);
  return vp;
}

type SlotState = 'waiting' | 'shown' | 'gone';
type SlotName = 'left' | 'right' | 'bottom';

/** One ad unit in a fixed, labelled box. Swap the network here. */
function AdSlot({
  config,
  name,
  size,
  onState,
}: {
  config: AdsConfig;
  name: SlotName;
  size: { width: number; height: number };
  onState: (name: SlotName, state: SlotState) => void;
}) {
  const slotId = config.mode === 'adsense' ? config.slots[name] : null;
  const insRef = useRef<HTMLModElement | null>(null);
  const [state, setState] = useState<SlotState>(config.mode === 'placeholder' ? 'shown' : 'waiting');

  useEffect(() => {
    onState(name, config.mode === 'adsense' && !slotId ? 'gone' : state);
  }, [name, state, slotId, config.mode, onState]);

  useEffect(() => {
    if (config.mode !== 'adsense' || !config.clientId || !slotId) return;
    let cancelled = false;
    let observer: MutationObserver | null = null;
    const stop = afterFirstPaint(() => {
      void loadAdSense(config.clientId!).then((ok) => {
        if (cancelled) return;
        const ins = insRef.current;
        if (!ok || !ins) {
          setState('gone');
          return;
        }
        // AdSense marks slots it couldn't fill; drop them rather than leave an empty box.
        observer = new MutationObserver(() => {
          if (ins.getAttribute('data-ad-status') === 'unfilled') setState('gone');
        });
        observer.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
        try {
          ((window as AdsWindow).adsbygoogle ||= []).push({});
          setState('shown');
        } catch {
          setState('gone');
        }
      });
    });
    return () => {
      cancelled = true;
      stop();
      observer?.disconnect();
    };
  }, [config.mode, config.clientId, slotId]);

  if (config.mode === 'off' || (config.mode === 'adsense' && !slotId) || state === 'gone') return null;
  const bottom = name === 'bottom';
  return (
    <aside
      className={`${bottom ? 'ad-bottom' : `ad-rail ad-rail--${name}`}${state === 'waiting' ? ' ad--waiting' : ''}`}
      aria-label="Advertisement"
    >
      <p className="ad-label">Advertisement{bottom ? ' · not advice from KoruLedger' : ''}</p>
      <div className="ad-box" style={{ width: size.width, height: size.height }}>
        {config.mode === 'adsense' ? (
          <ins
            // A new size needs a new ad unit, so remount when it changes.
            key={`${size.width}x${size.height}`}
            ref={insRef}
            className="adsbygoogle"
            style={{ display: 'inline-block', width: size.width, height: size.height }}
            data-ad-client={config.clientId ?? undefined}
            data-ad-slot={slotId ?? undefined}
            // Contextless: the ad network sees the site root, never this page or its figures.
            data-page-url={`${window.location.origin}/`}
          />
        ) : (
          <span className="ad-placeholder">
            Ad slot {size.width}×{size.height} (dev placeholder)
          </span>
        )}
      </div>
      {bottom ? null : <p className="ad-note">Not advice from KoruLedger.</p>}
    </aside>
  );
}

/** Asks once whether ads may be personalised; the answer can be changed in Settings. */
function AdConsentPrompt() {
  const [choice, setChoice] = useState<AdPersonalisation | null>(() => readAdPersonalisation(window.localStorage));
  if (choice) return null;
  const choose = (v: AdPersonalisation) => {
    setAdPersonalisation(v);
    setChoice(v);
  };
  return (
    <div className="ad-consent" role="region" aria-label="Ad preferences">
      <p>
        Ads on this page are <strong>not personalised</strong> and never see your finances. Allow personalised ads
        from Google instead? <Link to="/privacy#advertising">How ads work</Link>
      </p>
      <div className="row gap">
        <button type="button" className="btn small" onClick={() => choose('non_personalised')}>
          Keep not personalised
        </button>
        <button type="button" className="btn small ghost" onClick={() => choose('personalised')}>
          Allow personalised
        </button>
      </div>
    </div>
  );
}

/** Ads for the signed-in layout. Renders nothing unless ads are on. */
export function PageAds() {
  const { pathname } = useLocation();
  const viewport = useViewport();
  const [config, setConfig] = useState<AdsConfig | null>(null);
  const [states, setStates] = useState<Partial<Record<SlotName, SlotState>>>({});
  const [onState] = useState(
    () => (name: SlotName, state: SlotState) => setStates((prev) => (prev[name] === state ? prev : { ...prev, [name]: state })),
  );

  useEffect(() => {
    let cancelled = false;
    void loadAdsConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const placement = adPlacement(config, viewport, pathname);
  const bottomSize = bottomAdSize(viewport.width);
  const names: SlotName[] = placement === 'side' ? ['left', 'right'] : placement === 'bottom' ? ['bottom'] : [];
  const live = names.filter((n) => states[n] !== 'gone');
  const bottomLive = placement === 'bottom' && live.length > 0;

  // Keep room at the end of the page so the bottom banner never covers content.
  useEffect(() => {
    const root = document.documentElement;
    if (bottomLive) root.style.setProperty('--ad-bottom-space', `${bottomSize.height + 30}px`);
    else root.style.removeProperty('--ad-bottom-space');
    root.classList.toggle('has-bottom-ad', bottomLive);
    return () => {
      root.style.removeProperty('--ad-bottom-space');
      root.classList.remove('has-bottom-ad');
    };
  }, [bottomLive, bottomSize.height]);

  if (!config || !placement) return null;
  return (
    <>
      {names.map((n) => (
        <AdSlot key={n} config={config} name={n} size={n === 'bottom' ? bottomSize : SIDE_AD} onState={onState} />
      ))}
      {/* Only ask once an ad can actually show (not when blocked or unfilled). */}
      {names.some((n) => states[n] === 'shown') ? <AdConsentPrompt /> : null}
    </>
  );
}
