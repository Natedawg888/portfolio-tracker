/**
 * Tour engine: step navigation, pause, skip, and the coachmark markup.
 * Run: npm run test:tour
 */
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Coachmark } from './Coachmark.tsx';
import {
  COACHMARK_EDGE_PX,
  HIGHLIGHT_OFFSET_PX,
  HIGHLIGHT_OUTLINE_PX,
  COACHMARK_GAP_PX,
  coachmarkPlacement,
  commandForKey,
  currentStep,
  initialTourState,
  needsScroll,
  placeCoachmark,
  primaryActionLabel,
  reduceTour,
  routeMatches,
  scrollIntoViewOptions,
  stepCounterLabel,
  tourTargetSelector,
  withSteps,
  type TourState,
  type TourStep,
} from './engine.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function eq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (got ${String(actual)}, expected ${String(expected)})`);
  }
}

const steps: TourStep[] = [
  { target: 'net-worth', route: '/', title: 'Net worth', body: 'Assets minus debt.' },
  { target: 'money-snapshot', route: '/', title: 'This month', body: 'Income, spending and savings for the month.' },
  { target: 'budget-header', route: '/spending', title: 'Budget', body: 'The month on screen.', phonePlacement: 'top' },
];

function at(index: number, phase: TourState['phase'] = 'active'): TourState {
  return { phase, index, steps };
}

// --- navigation ---
{
  const idle = initialTourState(steps);
  eq(idle.phase, 'idle', 'a new tour is idle');
  eq(idle.index, 0, 'a new tour sits on the first step');

  const started = reduceTour(idle, 'start');
  eq(started.phase, 'active', 'start runs the tour');
  eq(started.index, 0, 'start begins at the first step');
  eq(currentStep(started)?.target, 'net-worth', 'the first step is current');

  const second = reduceTour(started, 'next');
  eq(second.index, 1, 'next moves one step forward');
  eq(second.phase, 'active', 'next keeps the tour active');

  const third = reduceTour(second, 'next');
  eq(third.index, 2, 'next again lands on the last step');

  const back = reduceTour(third, 'back');
  eq(back.index, 1, 'back moves one step backward');
  eq(back.phase, 'active', 'back keeps the tour active');

  const first = reduceTour(reduceTour(back, 'back'), 'back');
  eq(first.index, 0, 'back stops on the first step');
  assert(reduceTour(first, 'back') === first, 'back on the first step is a no-op');

  const done = reduceTour(third, 'next');
  eq(done.phase, 'idle', 'next on the last step finishes the tour');
  eq(done.index, 0, 'a finished tour is ready to start again');
  assert(currentStep(done) === null, 'an idle tour has no current step');

  const restarted = reduceTour(at(2, 'paused'), 'start');
  eq(restarted.phase, 'active', 'start from a pause runs again');
  eq(restarted.index, 0, 'start always restarts at the first step');
}

// --- pause, resume, skip ---
{
  const mid = at(1);
  const paused = reduceTour(mid, 'pause');
  eq(paused.phase, 'paused', 'pause leaves the tour paused');
  eq(paused.index, 1, 'pause keeps the step');
  assert(reduceTour(paused, 'pause') === paused, 'pausing twice is a no-op');
  assert(reduceTour(paused, 'next') === paused, 'next does nothing while paused');
  assert(reduceTour(paused, 'back') === paused, 'back does nothing while paused');
  eq(currentStep(paused)?.title, 'This month', 'the paused step is still current');

  const resumed = reduceTour(paused, 'resume');
  eq(resumed.phase, 'active', 'resume continues');
  eq(resumed.index, 1, 'resume stays on the paused step');
  assert(reduceTour(resumed, 'resume') === resumed, 'resume while active is a no-op');

  const idle = initialTourState(steps);
  assert(reduceTour(idle, 'pause') === idle, 'pause while idle is a no-op');
  assert(reduceTour(idle, 'resume') === idle, 'resume while idle is a no-op');
  assert(reduceTour(idle, 'skip') === idle, 'skip while idle is a no-op');
  assert(reduceTour(idle, 'next') === idle, 'next while idle is a no-op');

  const skipped = reduceTour(mid, 'skip');
  eq(skipped.phase, 'idle', 'skip ends an active tour');
  eq(skipped.index, 0, 'skip clears the step');
  const skippedPause = reduceTour(paused, 'skip');
  eq(skippedPause.phase, 'idle', 'skip ends a paused tour');
  eq(skippedPause.index, 0, 'skip from pause clears the step');
}

// --- Esc ---
{
  eq(commandForKey('Escape', 'active'), 'pause', 'Esc pauses an active tour');
  assert(commandForKey('Escape', 'paused') === null, 'Esc does not resume');
  assert(commandForKey('Escape', 'idle') === null, 'Esc does nothing while idle');
  assert(commandForKey('Enter', 'active') === null, 'other keys are ignored');

  const paused = reduceTour(at(2), commandForKey('Escape', 'active')!);
  eq(paused.phase, 'paused', 'the Esc command pauses');
  eq(paused.index, 2, 'Esc keeps the step');
}

// --- empty list and a shorter list ---
{
  const empty = initialTourState([]);
  assert(reduceTour(empty, 'start') === empty, 'start with no steps stays idle');
  const shorter = steps.slice(0, 2);
  const shrunk = withSteps({ phase: 'active', index: 4, steps }, shorter);
  eq(shrunk.index, 1, 'a shorter list clamps the index');
  eq(shrunk.phase, 'active', 'clamping keeps the phase');
  const cleared = withSteps(at(1), []);
  eq(cleared.phase, 'idle', 'removing every step idles the tour');
}

// --- counter, selector, route, motion, placement ---
{
  eq(stepCounterLabel(2, 9), 'Step 3 of 9', 'counter is 1-based for screen readers');
  eq(primaryActionLabel(2, 9), 'Next', 'a middle step offers Next');
  eq(primaryActionLabel(8, 9), 'Done', 'the last step offers Done');

  eq(tourTargetSelector('net-worth'), '[data-tour="net-worth"]', 'a token becomes a data-tour selector');
  eq(tourTargetSelector('[data-tour="paye-title"]'), '[data-tour="paye-title"]', 'a full selector is kept');
  eq(tourTargetSelector('say "hi"'), '[data-tour="say \\"hi\\""]', 'quotes in a token are escaped');

  assert(routeMatches('/', '', '', '/'), 'root route matches');
  assert(routeMatches('/paye', '', '', '/paye'), 'a path matches');
  assert(!routeMatches('/paye', '', '', '/'), 'a different path does not match');
  assert(routeMatches('/portfolio', '', '#stocks', '/portfolio#stocks'), 'a hash is part of the route when given');

  eq(scrollIntoViewOptions(false).behavior, 'smooth', 'scroll animates by default');
  eq(scrollIntoViewOptions(true).behavior, 'auto', 'reduced motion jumps');
  eq(scrollIntoViewOptions(true).block, 'center', 'the target is centred');

  assert(!needsScroll({ top: 40, left: 20, bottom: 200, right: 300 }, { width: 800, height: 600 }), 'an on-screen target does not scroll');
  assert(needsScroll({ top: -4, left: 20, bottom: 80, right: 100 }, { width: 800, height: 600 }), 'a target above the fold scrolls');

  eq(coachmarkPlacement(false, 'top'), 'anchored', 'desktop ignores phone placement');
  eq(coachmarkPlacement(true, undefined), 'sheet-bottom', 'phones default to a bottom sheet');
  eq(coachmarkPlacement(true, 'bottom'), 'sheet-bottom', 'bottom placement is a bottom sheet');
  eq(coachmarkPlacement(true, 'top'), 'sheet-top', 'top placement is a top sheet');

  const below = placeCoachmark(
    { top: 40, left: 32, width: 200, height: 48 },
    { width: 1200, height: 800 },
    { width: 360, height: 160 },
  );
  const clearance = HIGHLIGHT_OFFSET_PX + HIGHLIGHT_OUTLINE_PX + COACHMARK_GAP_PX;
  eq(below.top, 40 + 48 + clearance, 'the card sits below the highlight');
  eq(below.left, 32, 'the card lines up with the target when it fits');

  const flipped = placeCoachmark(
    { top: 700, left: 40, width: 200, height: 60 },
    { width: 1000, height: 800 },
    { width: 360, height: 180 },
  );
  eq(flipped.top, 700 - clearance - 180, 'the card flips above when it would not fit below');

  const clamped = placeCoachmark(
    { top: 40, left: 900, width: 80, height: 40 },
    { width: 1000, height: 800 },
    { width: 360, height: 120 },
  );
  eq(clamped.left, 1000 - 360 - COACHMARK_EDGE_PX, 'the card stays inside the right edge');
}

// --- coachmark markup (not mounted; rendered to a string) ---
// node --import tsx compiles JSX with the classic runtime, which expects a global React.
(globalThis as unknown as { React: typeof React }).React = React;

function markup(index: number, total: number, placement: 'anchored' | 'sheet-bottom' | 'sheet-top', reducedMotion: boolean): string {
  return renderToStaticMarkup(
    createElement(Coachmark, {
      title: 'Net worth',
      body: 'Assets minus debt.',
      index,
      total,
      placement,
      reducedMotion,
      onBack: () => {},
      onNext: () => {},
      onSkip: () => {},
    }),
  );
}

{
  const html = markup(2, 9, 'anchored', false);
  assert(html.includes('Step 3 of 9'), 'screen readers get Step 3 of 9');
  assert(html.includes('sr-only'), 'the counter is visually hidden');
  assert(html.includes('aria-hidden="true"'), 'the dots are hidden from screen readers');
  assert(html.includes('role="region"'), 'the card is a region');
  assert(!html.includes('aria-modal'), 'the card is not modal');
  assert(!html.includes('role="dialog"'), 'the card is not a dialog');
  assert(html.includes('tabindex="-1"'), 'the card can take focus');
  assert(html.includes('>Next<'), 'a middle step says Next');
  assert(!html.includes('>Done<'), 'a middle step does not say Done');
  assert(html.includes('>Back<'), 'Back is present');
  assert(html.includes('>Skip tour<'), 'Skip tour is present');
  assert(!html.includes('<svg'), 'the card adds no icons');
  assert(!html.includes('tour-card--still'), 'motion keeps the fade class off the still flag');
  assert(!/you should|buy|sell/i.test(html), 'the card adds no advice copy');

  const dots = html.slice(html.indexOf('tour-dots'), html.indexOf('tour-actions'));
  const marks = [...dots.matchAll(/class="tour-dot(?: is-current)?"/g)].map((match) => match[0]);
  eq(marks.length, 9, 'one dot per step');
  eq(marks[2], 'class="tour-dot is-current"', 'the current dot is the third');

  const first = markup(0, 9, 'sheet-bottom', true);
  assert(first.includes('disabled'), 'Back is disabled on the first step');
  assert(first.includes('tour-card--sheet-bottom'), 'a phone step can be a bottom sheet');
  assert(first.includes('tour-card--still'), 'reduced motion marks the card still');
  assert(first.includes('>Next<'), 'the first step says Next');

  const last = markup(8, 9, 'sheet-top', false);
  assert(last.includes('>Done<'), 'the last step says Done');
  assert(!last.includes('>Next<'), 'the last step does not say Next');
  assert(last.includes('tour-card--sheet-top'), 'phone placement top is a top sheet');
  assert(!last.includes('disabled'), 'Back is enabled after the first step');
}

console.log('tour engine: ok');
