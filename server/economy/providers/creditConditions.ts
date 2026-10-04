/**
 * United States credit conditions from the Federal Reserve Senior Loan Officer
 * Opinion Survey. The file reports net tightening. This app stores the negative,
 * so a higher number means easier credit.
 */
import { quarterRange } from '../periods.ts';
import { attachPrevious, type DatedValue, type WithPrevious } from './derive.ts';
import { fetchDownload } from './http.ts';
import { publishedDay } from './housingStarts.ts';
import { unzipEntries } from './zip.ts';

export const SLOOS_URL = 'https://www.federalreserve.gov/releases/sloos/data/FRB_SLOOS_xml.zip';

/** Net percentage of domestic banks tightening standards for C&I loans to large and middle-market firms. */
export const SLOOS_CI_TIGHTENING = 'SUBLPDCIAI_N.Q';

export function parseSloosNetEasing(xml: string, seriesName: string): DatedValue[] {
  const marker = `SERIES_NAME="${seriesName}"`;
  const start = xml.indexOf(marker);
  if (start < 0) throw new Error(`The SLOOS file has no ${seriesName} series.`);
  const end = xml.indexOf('</kf:Series>', start);
  const block = xml.slice(start, end === -1 ? undefined : end);
  const out: DatedValue[] = [];
  for (const match of block.matchAll(/OBS_VALUE="([^"]+)"[^>]*TIME_PERIOD="([^"]+)"/g)) {
    const tightening = Number(match[1]);
    const period = quarterFromEnd(match[2] ?? '');
    if (!Number.isFinite(tightening) || !period) continue;
    if (period.period < '2012-Q1') continue;
    out.push({ ...period, value: Math.round(-tightening * 10000) / 10000 });
  }
  return out;
}

function quarterFromEnd(iso: string): Omit<DatedValue, 'value'> | null {
  const match = iso.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month % 3 !== 0) return null;
  const quarter = (month / 3) as 1 | 2 | 3 | 4;
  const range = quarterRange(year, quarter);
  return {
    period: range.period,
    periodStart: range.start,
    periodEnd: range.end,
    frequency: 'quarterly',
  };
}

export async function loadUsCreditConditions(): Promise<{ rates: WithPrevious[]; publishedAt: string | null }> {
  const download = await fetchDownload(SLOOS_URL, { timeoutMs: 40_000, maxBytes: 2_000_000 });
  const xml = unzipEntries(download.body).get('SLOOS_data.xml');
  if (!xml) throw new Error('The SLOOS zip has no SLOOS_data.xml.');
  const rates = attachPrevious(parseSloosNetEasing(xml.toString('utf8'), SLOOS_CI_TIGHTENING));
  if (rates.length === 0) throw new Error('The SLOOS file did not include a credit-standards series.');
  return { rates, publishedAt: publishedDay(download.lastModified) };
}
