import { fetchNzPublic } from './nzPublic.ts';
import { sampleProvider } from './sample.ts';
import { fetchUsPublic } from './usPublic.ts';
import type { EconomicDataProvider } from './types.ts';

export const nzPublicProvider: EconomicDataProvider = {
  id: 'nz-public',
  label: 'New Zealand public extracts (Stats NZ and OECD)',
  kind: 'live',
  country: 'NZ',
  fetch: () => fetchNzPublic(),
};

export const usPublicProvider: EconomicDataProvider = {
  id: 'us-public',
  label: 'United States public extracts (OECD)',
  kind: 'live',
  country: 'US',
  fetch: () => fetchUsPublic(),
};

export function getEconomicProvider(country = 'NZ'): EconomicDataProvider {
  const choice = (process.env.ECONOMY_PROVIDER ?? '').trim().toLowerCase();
  if (choice === 'sample') return sampleProvider;
  if (country === 'US') return usPublicProvider;
  return nzPublicProvider;
}

export { sampleProvider, buildSampleObservations } from './sample.ts';
