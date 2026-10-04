/**
 * Business activity from the OECD production tendency.
 * The published figure is a percentage balance around zero. The scorer reads a
 * diffusion index: 50 plus half that balance, so 50 is the published neutral point.
 */
import { attachPrevious, type DatedValue, type WithPrevious } from './derive.ts';
import { loadOecdMeasure, oecdBtsUrl } from './oecd.ts';

const FORMULA = 'Diffusion index calculated in this app as 50 plus half the OECD percentage balance, so 50 is the published neutral point. This is not a branded purchasing managers’ index.';

export function diffusionFromBalance(points: DatedValue[]): DatedValue[] {
  return points.map((point) => ({
    ...point,
    value: Math.round((50 + point.value / 2) * 10000) / 10000,
  }));
}

async function loadProductionDiffusion(key: string): Promise<WithPrevious[]> {
  const balance = await loadOecdMeasure(oecdBtsUrl(key), 'PR');
  return attachPrevious(diffusionFromBalance(balance));
}

/** New Zealand production tendency, current horizon, calendar and seasonally adjusted. */
export function loadNzBusinessActivity(): Promise<WithPrevious[]> {
  return loadProductionDiffusion('NZL.Q.PR.PB.C.Y._Z.T.N');
}

/** United States production tendency, current horizon, calendar and seasonally adjusted. */
export function loadUsBusinessActivity(): Promise<WithPrevious[]> {
  return loadProductionDiffusion('USA.M.PR.PB.C.Y._Z.T.N');
}

export const BUSINESS_ACTIVITY_NOTE = `${FORMULA} The OECD extract has no publication timestamp, so published_at is the period end.`;

export function businessActivitySourceUrl(key: string): string {
  return oecdBtsUrl(key);
}

export const NZ_BUSINESS_KEY = 'NZL.Q.PR.PB.C.Y._Z.T.N';
export const US_BUSINESS_KEY = 'USA.M.PR.PB.C.Y._Z.T.N';
