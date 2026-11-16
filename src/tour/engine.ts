/**
 * KoruLedger onboarding tour — pure step machine.
 * The provider is not mounted yet, so nothing starts on its own.
 *
 * A step names a data-tour target, the route that target lives on, a title,
 * a body, and an optional phone placement. Esc pauses. The tour is not modal.
 */

export type TourPhonePlacement = 'top' | 'bottom';

export type TourStep = {
  /** data-tour value, or a CSS selector that already starts with # . or [. */
  target: string;
  /** Path the app should be on before this step is shown. */
  route: string;
  title: string;
  body: string;
  /** Phones only. Omitted means a bottom sheet. Desktop ignores this. */
  phonePlacement?: TourPhonePlacement;
};

export type TourPhase = 'idle' | 'active' | 'paused';

export type TourState = {
  phase: TourPhase;
  /** Current step. Idle tours sit at 0 so the next start begins at the first step. */
  index: number;
  steps: readonly TourStep[];
};

export type TourCommand = 'start' | 'next' | 'back' | 'skip' | 'pause' | 'resume';

/** Matches the phone layout in App.css (nav drawer at max-width 768px). */
export const TOUR_MOBILE_QUERY = '(max-width: 768px)';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Highlight ring: 2px outline, 6px outside the target. */
export const HIGHLIGHT_OUTLINE_PX = 2;
export const HIGHLIGHT_OFFSET_PX = 6;
/** Space between that ring and the card. */
export const COACHMARK_GAP_PX = 16;
export const COACHMARK_EDGE_PX = 8;

const COACHMARK_CLEARANCE_PX = HIGHLIGHT_OFFSET_PX + HIGHLIGHT_OUTLINE_PX + COACHMARK_GAP_PX;

export function initialTourState(steps: readonly TourStep[] = []): TourState {
  return { phase: 'idle', index: 0, steps };
}

export function sameSteps(a: readonly TourStep[], b: readonly TourStep[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.target !== right.target ||
      left.route !== right.route ||
      left.title !== right.title ||
      left.body !== right.body ||
      left.phonePlacement !== right.phonePlacement
    ) {
      return false;
    }
  }
  return true;
}

/** Swap the step list without dropping pause/progress, unless the list is now empty. */
export function withSteps(state: TourState, steps: readonly TourStep[]): TourState {
  if (sameSteps(state.steps, steps)) return state;
  if (steps.length === 0) return { phase: 'idle', index: 0, steps };
  const index = Math.min(state.index, steps.length - 1);
  return { ...state, steps, index };
}

export function reduceTour(state: TourState, command: TourCommand): TourState {
  switch (command) {
    case 'start':
      if (state.steps.length === 0) {
        if (state.phase === 'idle' && state.index === 0) return state;
        return { ...state, phase: 'idle', index: 0 };
      }
      return { ...state, phase: 'active', index: 0 };
    case 'next':
      if (state.phase !== 'active') return state;
      if (state.index >= state.steps.length - 1) return { ...state, phase: 'idle', index: 0 };
      return { ...state, index: state.index + 1 };
    case 'back':
      if (state.phase !== 'active' || state.index <= 0) return state;
      return { ...state, index: state.index - 1 };
    case 'skip':
      if (state.phase === 'idle') return state;
      return { ...state, phase: 'idle', index: 0 };
    case 'pause':
      if (state.phase !== 'active') return state;
      return { ...state, phase: 'paused' };
    case 'resume':
      if (state.phase !== 'paused') return state;
      return { ...state, phase: 'active' };
    default: {
      const never: never = command;
      return never;
    }
  }
}

/** Esc pauses an active tour. It does not resume, and it does nothing while idle. */
export function commandForKey(key: string, phase: TourPhase): TourCommand | null {
  if (key === 'Escape' && phase === 'active') return 'pause';
  return null;
}

export function currentStep(state: TourState): TourStep | null {
  if (state.phase === 'idle') return null;
  return state.steps[state.index] ?? null;
}

/** Screen-reader step counter. Index is 0-based: (2, 9) reads "Step 3 of 9". */
export function stepCounterLabel(index: number, total: number): string {
  return `Step ${index + 1} of ${total}`;
}

export function primaryActionLabel(index: number, total: number): 'Next' | 'Done' {
  return total > 0 && index >= total - 1 ? 'Done' : 'Next';
}

export function tourTargetSelector(target: string): string {
  const value = target.trim();
  if (!value) return '';
  if (value.startsWith('[') || value.startsWith('#') || value.startsWith('.')) return value;
  return `[data-tour="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

export function routeMatches(pathname: string, search: string, hash: string, route: string): boolean {
  if (route.includes('?') || route.includes('#')) {
    return `${pathname}${search}${hash}` === route || `${pathname}${search}` === route;
  }
  return pathname === route;
}

export type CoachmarkPlacement = 'anchored' | 'sheet-bottom' | 'sheet-top';

/** Below the mobile breakpoint the card is a sheet. Desktop anchors it near the target. */
export function coachmarkPlacement(isPhone: boolean, phonePlacement: TourPhonePlacement | undefined): CoachmarkPlacement {
  if (!isPhone) return 'anchored';
  return phonePlacement === 'top' ? 'sheet-top' : 'sheet-bottom';
}

export function scrollIntoViewOptions(reducedMotion: boolean): ScrollIntoViewOptions {
  return {
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'center',
    inline: 'nearest',
  };
}

export function needsScroll(
  rect: { top: number; left: number; bottom: number; right: number },
  viewport: { width: number; height: number },
  margin = 12,
): boolean {
  return (
    rect.top < margin ||
    rect.left < margin ||
    rect.bottom > viewport.height - margin ||
    rect.right > viewport.width - margin
  );
}

export type Box = { top: number; left: number; width: number; height: number };

/** Desktop card position. Prefers below the target, then above, and stays inside the viewport. */
export function placeCoachmark(
  target: Box,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
): { top: number; left: number } {
  const edge = COACHMARK_EDGE_PX;
  const maxLeft = Math.max(edge, viewport.width - card.width - edge);
  let left = target.left;
  if (left > maxLeft) left = maxLeft;
  if (left < edge) left = edge;

  const below = target.top + target.height + COACHMARK_CLEARANCE_PX;
  const above = target.top - COACHMARK_CLEARANCE_PX - card.height;
  const fitsBelow = below + card.height <= viewport.height - edge;
  const fitsAbove = above >= edge;
  let top = below;
  if (!fitsBelow && fitsAbove) top = above;
  else if (!fitsBelow) top = Math.max(edge, viewport.height - card.height - edge);
  return { top, left };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Scroll the target into view before the card is shown.
 * prefers-reduced-motion uses an instant jump; otherwise the scroll is smooth
 * and the promise resolves on scrollend (or shortly after, if the browser
 * never fires one).
 */
export function scrollTargetIntoView(el: Element, reducedMotion: boolean): { promise: Promise<void>; cancel: () => void } {
  const rect = el.getBoundingClientRect();
  if (!needsScroll(rect, { width: window.innerWidth, height: window.innerHeight })) {
    return { promise: Promise.resolve(), cancel: () => {} };
  }

  let settle: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    if (reducedMotion) {
      el.scrollIntoView(scrollIntoViewOptions(true));
      resolve();
      return;
    }
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('scrollend', finish);
      window.clearTimeout(timer);
      resolve();
    };
    settle = finish;
    window.addEventListener('scrollend', finish);
    timer = window.setTimeout(finish, 800);
    el.scrollIntoView(scrollIntoViewOptions(false));
  });
  return { promise, cancel: () => settle?.() };
}
