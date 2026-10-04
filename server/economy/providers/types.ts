import type { EconomicObservation, ProviderKind } from '../types.ts';

export type ProviderFetchResult = {
  providerId: string;
  providerLabel: string;
  kind: ProviderKind;
  country: string;
  retrievedAt: string;
  observations: EconomicObservation[];
  warnings: string[];
};

export interface EconomicDataProvider {
  id: string;
  label: string;
  kind: ProviderKind;
  country: string;
  /** `country` is the requested code. A single-country provider may ignore it. */
  fetch(country?: string): Promise<ProviderFetchResult>;
}
