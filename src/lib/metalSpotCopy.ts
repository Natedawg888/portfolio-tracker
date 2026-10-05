/**
 * Short metal-spot status for cards. Matches the provider the server actually used.
 */
export type MetalSpotStatus = 'ok' | 'stale' | 'unavailable';
export type MetalSpotSource = 'gold-api' | 'metals_dev';

export function metalSpotHint(input: {
  status?: MetalSpotStatus | null;
  source?: MetalSpotSource | null;
  configured?: boolean;
}): string {
  const dev = input.source === 'metals_dev' || (input.source == null && input.configured === true);
  if (input.status === 'ok' || input.status === 'stale') {
    if (dev) {
      return input.status === 'stale'
        ? 'Metals.Dev spot NZD (last good; quota or refresh miss)'
        : 'Metals.Dev spot NZD';
    }
    return input.status === 'stale' ? 'gold-api.com spot NZD (cached)' : 'gold-api.com spot NZD';
  }
  if (input.configured) {
    return 'Refresh on Portfolio or Value search for a spot. The last good value stays if the quota is used up.';
  }
  return 'No stored spot yet';
}

export function metalProviderFooter(provider: string | null): string {
  if (provider === 'metals.dev' || provider === 'metals_dev') {
    return 'metals via Metals.Dev (never invented)';
  }
  if (provider === 'gold-api.com' || provider === 'gold-api') {
    return 'metals via gold-api.com (never invented)';
  }
  return 'metal spots are never invented';
}
