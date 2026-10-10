/**
 * Choose the observations that count for each quarter, then score them.
 */
import { assessTimeline, type TimelineFrame, type TimelinePoint } from './scoring.ts';
import { INDICATOR_TYPES, type EconomicObservation, type IndicatorType } from './types.ts';
import { latestAsOf, latestCompletedQuarter, listQuarters, periodEnd } from './periods.ts';

export type Analysis = {
  asOfPeriod: string;
  timeline: TimelinePoint[];
  current: TimelinePoint | null;
  /** Scored inputs for each quarter, in timeline order. */
  frames: TimelineFrame[];
  used: Map<IndicatorType, EconomicObservation | null>;
  byType: Map<IndicatorType, EconomicObservation[]>;
};

export function analyseObservations(observations: EconomicObservation[], now: Date): Analysis {
  const byType = new Map<IndicatorType, EconomicObservation[]>();
  for (const row of observations) {
    const list = byType.get(row.indicatorType) ?? [];
    list.push(row);
    byType.set(row.indicatorType, list);
  }

  const end = latestCompletedQuarter(now);
  const frames: TimelineFrame[] = [];
  for (const quarter of listQuarters('2012-Q1', end)) {
    const quarterEnd = periodEnd(quarter);
    if (!quarterEnd) continue;
    const inputs = [];
    for (const indicator of INDICATOR_TYPES) {
      const row = latestAsOf(byType.get(indicator) ?? [], quarterEnd);
      if (!row) continue;
      inputs.push({
        indicator,
        value: row.value,
        previousValue: row.previousValue,
      });
    }
    if (inputs.length >= 3) frames.push({ period: quarter, inputs });
  }

  const timeline = assessTimeline(frames);
  const current = timeline.at(-1) ?? null;
  const asOfPeriod = current?.period ?? end;
  const asOfEnd = periodEnd(asOfPeriod) ?? periodEnd(end) ?? '1970-01-01';
  const used = new Map<IndicatorType, EconomicObservation | null>();
  for (const indicator of INDICATOR_TYPES) {
    used.set(indicator, latestAsOf(byType.get(indicator) ?? [], asOfEnd));
  }
  return { asOfPeriod, timeline, current, frames, used, byType };
}
