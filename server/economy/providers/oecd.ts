/**
 * OECD SDMX public extracts for series Stats NZ does not ship as a long file
 * in the latest release, or that the Reserve Bank table does not expose here.
 */
import { periodFromOecd } from '../periods.ts';
import { collectSeries } from './csv.ts';
import { attachPrevious, changeOverMonths, subtractSeries, type DatedValue, type WithPrevious } from './derive.ts';
import { fetchText } from './http.ts';

const OECD = 'https://sdmx.oecd.org/public/rest/data';

const OECD_COLUMNS = {
  id: ['MEASURE', 'STRUCTURE_ID'],
  period: ['TIME_PERIOD'],
  value: ['OBS_VALUE'],
};

function url(path: string): string {
  return `${OECD}/${path}${path.includes('?') ? '&' : '?'}startPeriod=2012&format=csvfilewithlabels`;
}

export const OECD_URLS = {
  cpi: url('OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/NZL.Q.N.CPI.PA._T.N.GY'),
  unemployment: url('OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/NZL.UNE_LF_M.PT_LF_SUB._Z.Y._T.Y_GE15._Z.Q'),
  callRate: url('OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/NZL.M.IRSTCI.PA._Z._Z._Z._Z.N'),
  longRate: url('OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/NZL.M.IRLT.PA._Z._Z._Z._Z.N'),
  shortRate: url('OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/NZL.M.IR3TIB.PA._Z._Z._Z._Z.N'),
  shares: url('OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/NZL.M.SHARE.IX._Z._Z._Z._Z.N'),
};

async function loadMeasure(endpoint: string, measure: string): Promise<DatedValue[]> {
  const text = await fetchText(endpoint, { timeoutMs: 45_000, maxBytes: 8_000_000 });
  const found = collectSeries(text, new Set([measure]), OECD_COLUMNS);
  const out: DatedValue[] = [];
  for (const point of found.get(measure) ?? []) {
    const range = periodFromOecd(point.periodRaw);
    if (!range) continue;
    out.push({
      period: range.period,
      periodStart: range.start,
      periodEnd: range.end,
      value: point.value,
      frequency: range.frequency,
    });
  }
  return out;
}

export async function loadOecdCpi(): Promise<WithPrevious[]> {
  return attachPrevious(await loadMeasure(OECD_URLS.cpi, 'CPI'));
}

export async function loadOecdUnemployment(): Promise<WithPrevious[]> {
  return attachPrevious(await loadMeasure(OECD_URLS.unemployment, 'UNE_LF_M'));
}

export async function loadOecdCallRate(): Promise<WithPrevious[]> {
  return attachPrevious(await loadMeasure(OECD_URLS.callRate, 'IRSTCI'));
}

export async function loadOecdYieldSpread(): Promise<WithPrevious[]> {
  const [longRate, shortRate] = await Promise.all([
    loadMeasure(OECD_URLS.longRate, 'IRLT'),
    loadMeasure(OECD_URLS.shortRate, 'IR3TIB'),
  ]);
  return attachPrevious(subtractSeries(longRate, shortRate));
}

export async function loadOecdShareChange(): Promise<WithPrevious[]> {
  return loadShareIndexChange('NZL');
}

/** OECD key economic indicators. The key is the dimension path after the dataflow. */
export function oecdKeiUrl(key: string): string {
  return url(`OECD.SDD.STES,DSD_KEI@DF_KEI,4.0/${key}`);
}

export async function loadOecdMeasure(endpoint: string, measure: string): Promise<WithPrevious[]> {
  return attachPrevious(await loadMeasure(endpoint, measure));
}

/** Three-month percent change in the OECD share-price index for a reference area. */
export async function loadShareIndexChange(refArea: string): Promise<WithPrevious[]> {
  const index = await loadMeasure(
    url(`OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/${refArea}.M.SHARE.IX._Z._Z._Z._Z.N`),
    'SHARE',
  );
  return attachPrevious(changeOverMonths(index, 3));
}
