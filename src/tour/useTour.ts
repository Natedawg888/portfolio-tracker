import { useContext } from 'react';
import { TourContext, type TourControls } from './tourContext.ts';

export function useTour(): TourControls {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within TourProvider');
  return ctx;
}
