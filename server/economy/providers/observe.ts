import type {
  EconomicObservation,
  Frequency,
  IndicatorType,
  ProviderKind,
  PublishedAtPrecision,
} from '../types.ts';
import type { WithPrevious } from './derive.ts';

const KEEP_FROM = '2012-01-01';

export function toObservations(args: {
  points: WithPrevious[];
  country: string;
  indicatorType: IndicatorType;
  unit: string;
  source: string;
  sourceUrl: string | null;
  publishedAt: string;
  publishedAtPrecision: PublishedAtPrecision;
  retrievedAt: string;
  providerId: string;
  providerKind: ProviderKind;
  frequency: Frequency;
  seriesId: string | null;
  notes: string | null;
}): EconomicObservation[] {
  return args.points
    .filter((point) => point.periodEnd >= KEEP_FROM)
    .map((point) => ({
      country: args.country,
      indicatorType: args.indicatorType,
      value: point.value,
      unit: args.unit,
      period: point.period,
      periodStart: point.periodStart,
      periodEnd: point.periodEnd,
      previousValue: point.previousValue,
      previousPeriod: point.previousPeriod,
      source: args.source,
      sourceUrl: args.sourceUrl,
      publishedAt: args.publishedAtPrecision === 'release' ? args.publishedAt : point.periodEnd,
      publishedAtPrecision: args.publishedAtPrecision,
      retrievedAt: args.retrievedAt,
      providerId: args.providerId,
      providerKind: args.providerKind,
      frequency: args.frequency,
      seriesId: args.seriesId,
      notes: args.notes,
    }));
}
