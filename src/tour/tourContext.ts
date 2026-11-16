import { createContext } from 'react';
import type { TourPhase, TourStep } from './engine.ts';

export type TourControls = {
  steps: readonly TourStep[];
  phase: TourPhase;
  index: number;
  step: TourStep | null;
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  pause: () => void;
  resume: () => void;
};

export const TourContext = createContext<TourControls | null>(null);
