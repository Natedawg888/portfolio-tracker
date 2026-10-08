/**
 * Load or refresh observations for a connected country, score them, and return the dashboard payload.
 */
import { logger } from '../lib/logger.ts';
import { analyseObservations } from './analyse.ts';
import { requireEconomyCountry } from './countries.ts';
import { getEconomicProvider } from './providers/index.ts';
import { readFetchLog, readObservations, writeAssessments, writeObservations } from './store.ts';
import { buildCycleView, type CycleResponse } from './view.ts';

export { EconomyCountryError } from './countries.ts';

/** Bump when a provider starts returning a series the previous extract did not store. */
export const EXTRACT_REVISION = 'nz-credit-c60-2';

function cacheMs(): number {
  const hours = Number(process.env.ECONOMY_CACHE_HOURS ?? '12');
  if (!Number.isFinite(hours) || hours < 0) return 12 * 60 * 60 * 1000;
  return hours * 60 * 60 * 1000;
}

/** A refresh where some series failed is retried after an hour instead of being held for the full cache window. */
const PARTIAL_RETRY_MS = 60 * 60 * 1000;

export function cacheLifetimeMs(note: string | null | undefined): number {
  return visibleCacheNote(note) ? Math.min(PARTIAL_RETRY_MS, cacheMs()) : cacheMs();
}

export function cacheNote(warnings: string[]): string | null {
  const text = [`rev:${EXTRACT_REVISION}`, ...warnings].join(' ').trim();
  return text.slice(0, 500) || null;
}

export function cacheIsCurrent(note: string | null | undefined): boolean {
  return Boolean(note?.includes(`rev:${EXTRACT_REVISION}`));
}

export function visibleCacheNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const cleaned = note.replaceAll(`rev:${EXTRACT_REVISION}`, '').trim();
  return cleaned || null;
}

export async function getEconomicCycle(
  countryRaw: string | undefined,
  options: { refresh?: boolean; now?: Date } = {},
): Promise<CycleResponse> {
  const countryProfile = requireEconomyCountry(countryRaw);
  const country = countryProfile.code;
  const now = options.now ?? new Date();
  const provider = getEconomicProvider(country);
  let refreshError: string | null = null;
  let warnings: string[] = [];

  const log = await readFetchLog(country, provider.id);
  let observations = await readObservations(country, provider.id);
  const age = log ? now.getTime() - Date.parse(log.fetchedAt) : Number.POSITIVE_INFINITY;
  const fresh =
    Boolean(log?.ok) && age >= 0 && age < cacheLifetimeMs(log?.note) && observations.length > 0 && cacheIsCurrent(log?.note);
  const cachedNote = visibleCacheNote(log?.note);
  if (fresh && cachedNote) warnings = [cachedNote];

  if (options.refresh || !fresh) {
    try {
      const result = await provider.fetch(country);
      warnings = result.warnings;
      if (result.observations.length === 0 && observations.length > 0) {
        refreshError = 'The provider returned no observations. Showing the stored extract.';
      } else {
        await writeObservations({
          country,
          providerId: provider.id,
          observations: result.observations,
          fetchedAt: result.retrievedAt,
          note: cacheNote(result.warnings),
          ok: result.observations.length > 0,
        });
        observations = result.observations;
      }
      logger.info('economy_fetch', {
        provider: provider.id,
        observations: result.observations.length,
        warnings: result.warnings,
      });
    } catch (err) {
      refreshError = err instanceof Error ? err.message : String(err);
      logger.warn('economy_fetch_failed', { provider: provider.id, err: refreshError });
      if (observations.length === 0) {
        return buildCycleView({
          observations: [],
          country,
          provider: { id: provider.id, label: provider.label, kind: provider.kind },
          warnings: [refreshError],
          refreshError,
          now,
        });
      }
    }
  }

  const view = buildCycleView({
    observations,
    country,
    provider: { id: provider.id, label: provider.label, kind: provider.kind },
    warnings,
    refreshError,
    now,
  });
  const analysis = analyseObservations(observations, now);
  await writeAssessments({
    country,
    providerId: provider.id,
    providerKind: provider.kind,
    timeline: analysis.timeline,
    currentPeriod: analysis.current?.period ?? null,
    calculatedAt: now.toISOString(),
    coverageNote: view.coverageNote,
  });
  return view;
}
