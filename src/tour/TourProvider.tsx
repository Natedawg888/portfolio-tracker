/**
 * Tour provider. Not mounted in the app yet — wrap the router with it when a
 * later step turns the onboarding tour on. It has to sit inside the router.
 * Renders nothing while idle or paused. Esc pauses. Focus moves to the card.
 * The page behind is only dimmed (no blur, no focus trap, clicks pass through).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Coachmark } from './Coachmark.tsx';
import { TourContext, type TourControls } from './tourContext.ts';
import {
  TOUR_MOBILE_QUERY,
  REDUCED_MOTION_QUERY,
  coachmarkPlacement,
  commandForKey,
  currentStep,
  initialTourState,
  placeCoachmark,
  prefersReducedMotion,
  reduceTour,
  routeMatches,
  sameSteps,
  scrollTargetIntoView,
  tourTargetSelector,
  withSteps,
  type TourCommand,
  type TourState,
  type TourStep,
} from './engine.ts';
import './tour.css';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

type TargetBox = { top: number; left: number; width: number; height: number; radius: string };

function readTargetBox(el: Element): TargetBox {
  const rect = el.getBoundingClientRect();
  let radius = '12px';
  try {
    radius = getComputedStyle(el).borderRadius || radius;
  } catch {
    /* ignore */
  }
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, radius };
}

function sameBox(a: TargetBox | null, b: TargetBox): boolean {
  return a !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height && a.radius === b.radius;
}

function TourOverlay({
  step,
  index,
  total,
  onNext,
  onBack,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery(TOUR_MOBILE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const placement = coachmarkPlacement(phone, step.phonePlacement);

  useLayoutEffect(() => {
    const selector = tourTargetSelector(step.target);
    let el: Element | null = null;
    try {
      el = selector ? document.querySelector(selector) : null;
    } catch {
      el = null;
    }
    const update = () => {
      if (!el) {
        setTargetBox((prev) => (prev === null ? prev : null));
        return;
      }
      const next = readTargetBox(el);
      setTargetBox((prev) => (sameBox(prev, next) ? prev : next));
    };
    update();
    const observer = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (el) observer?.observe(el);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [step.target]);

  useLayoutEffect(() => {
    const place = () => {
      if (placement !== 'anchored' || !targetBox || !cardRef.current) {
        setAnchor((prev) => (prev === null ? prev : null));
        return;
      }
      const card = cardRef.current.getBoundingClientRect();
      const next = placeCoachmark(
        targetBox,
        { width: window.innerWidth, height: window.innerHeight },
        { width: card.width, height: card.height },
      );
      setAnchor((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
    };
    place();
  }, [placement, targetBox, step.title, step.body, index]);

  useEffect(() => {
    if (placement === 'anchored' && !anchor) return;
    const id = window.requestAnimationFrame(() => {
      cardRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [placement, anchor, index, step.target]);

  const style: CSSProperties | undefined =
    placement === 'anchored'
      ? anchor
        ? { top: anchor.top, left: anchor.left }
        : { top: 0, left: 0, visibility: 'hidden' }
      : undefined;

  return (
    <div className="tour-root">
      <div className="tour-dim" aria-hidden="true" />
      {targetBox && targetBox.width > 0 && targetBox.height > 0 ? (
        <div
          className="tour-highlight"
          style={{
            top: targetBox.top,
            left: targetBox.left,
            width: targetBox.width,
            height: targetBox.height,
            borderRadius: targetBox.radius,
          }}
          aria-hidden="true"
        />
      ) : null}
      <Coachmark
        cardRef={cardRef}
        title={step.title}
        body={step.body}
        index={index}
        total={total}
        placement={placement}
        reducedMotion={reducedMotion}
        style={style}
        onBack={onBack}
        onNext={onNext}
        onSkip={onSkip}
      />
    </div>
  );
}

export function TourProvider({ steps, children }: { steps: readonly TourStep[]; children: ReactNode }) {
  const [state, setState] = useState<TourState>(() => initialTourState(steps));
  if (!sameSteps(state.steps, steps)) {
    setState(withSteps(state, steps));
  }

  const dispatch = useCallback((command: TourCommand) => {
    setState((current) => reduceTour(current, command));
  }, []);
  const start = useCallback(() => dispatch('start'), [dispatch]);
  const next = useCallback(() => dispatch('next'), [dispatch]);
  const back = useCallback(() => dispatch('back'), [dispatch]);
  const skip = useCallback(() => dispatch('skip'), [dispatch]);
  const pause = useCallback(() => dispatch('pause'), [dispatch]);
  const resume = useCallback(() => dispatch('resume'), [dispatch]);

  useEffect(() => {
    if (state.phase !== 'active') return;
    const onKey = (event: KeyboardEvent) => {
      const command = commandForKey(event.key, 'active');
      if (!command) return;
      setState((current) => reduceTour(current, command));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.phase]);

  const navigate = useNavigate();
  const location = useLocation();
  const legRef = useRef<{ key: string; navigated: boolean } | null>(null);

  const active = state.phase === 'active' ? state.steps[state.index] ?? null : null;
  const legKey = active ? `${state.index}\0${active.route}\0${active.target}` : '';
  const onRoute = active !== null && routeMatches(location.pathname, location.search, location.hash, active.route);
  // Shown only after this step has been scrolled into view on its own route.
  // Clearing it during render (not in an effect) hides the card before the next paint.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (shownFor !== null && (!onRoute || shownFor !== legKey)) {
    setShownFor(null);
  }
  const ready = shownFor === legKey && legKey !== '' && onRoute;

  useEffect(() => {
    if (!active) {
      legRef.current = null;
      return;
    }
    if (!legRef.current || legRef.current.key !== legKey) {
      legRef.current = { key: legKey, navigated: false };
    }
    const leg = legRef.current;
    if (!onRoute) {
      // Navigate once when the step opens. Leaving the page later does not pull the user back.
      if (!leg.navigated) {
        leg.navigated = true;
        navigate(active.route);
      }
      return;
    }
    if (shownFor === legKey) return;

    let cancelled = false;
    let cancelScroll = () => {};
    const selector = tourTargetSelector(active.target);
    let el: Element | null = null;
    try {
      el = selector ? document.querySelector(selector) : null;
    } catch {
      el = null;
    }
    const job = el ? scrollTargetIntoView(el, prefersReducedMotion()) : { promise: Promise.resolve(), cancel: () => {} };
    cancelScroll = job.cancel;
    void job.promise.then(() => {
      if (cancelled) return;
      setShownFor(legKey);
    });
    return () => {
      cancelled = true;
      cancelScroll();
    };
  }, [active, legKey, onRoute, shownFor, navigate]);

  const step = currentStep(state);
  const value = useMemo<TourControls>(
    () => ({
      steps: state.steps,
      phase: state.phase,
      index: state.index,
      step,
      start,
      next,
      back,
      skip,
      pause,
      resume,
    }),
    [state.steps, state.phase, state.index, step, start, next, back, skip, pause, resume],
  );

  const show = state.phase === 'active' && ready && active != null;

  return (
    <TourContext.Provider value={value}>
      {children}
      {show && active ? (
        <TourOverlay step={active} index={state.index} total={state.steps.length} onNext={next} onBack={back} onSkip={skip} />
      ) : null}
    </TourContext.Provider>
  );
}
