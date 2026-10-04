import { fetchNzPublic } from './nzPublic.ts';
import { sampleProvider } from './sample.ts';
import type { EconomicDataProvider } from './types.ts';

export const nzPublicProvider: EconomicDataProvider = {
  id: 'nz-public',
  label: 'New Zealand public extracts (Stats NZ and OECD)',
  kind: 'live',
  country: 'NZ',
  fetch: fetchNzPublic,
};

export function getEconomicProvider(): EconomicDataProvider {
  const choice = (process.env.ECONOMY_PROVIDER ?? '').trim().toLowerCase();
  if (choice === 'sample') return sampleProvider;
  return nzPublicProvider;
}

export { sampleProvider, buildSampleObservations } from './sample.ts';
