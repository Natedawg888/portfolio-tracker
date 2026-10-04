/**
 * Stats NZ public release files. URLs come from the catalogue page so a new
 * quarter does not require a code change. No API key.
 */
import type { Frequency } from '../types.ts';
import { periodFromStatsNz, titleRecencyKey } from '../periods.ts';
import { collectSeries, type SeriesPoint } from './csv.ts';
import { attachPrevious, changeOverMonths } from './derive.ts';
import { decodeHtml, fetchBuffer, fetchText } from './http.ts';
import { unzipEntries } from './zip.ts';

const CATALOG_URL = 'https://www.stats.govt.nz/large-datasets/csv-files-for-download/';
const SITE = 'https://www.stats.govt.nz';

const STATS_COLUMNS = {
  id: ['Series_reference', 'Series_Reference'],
  period: ['Period'],
  value: ['Data_value', 'Data_Value'],
};

export type CatalogDoc = {
  title: string;
  url: string;
  extension: string;
};

export function parseCatalog(html: string): CatalogDoc[] {
  const match = html.match(/id="pageViewData" data-value="([\s\S]*?)"><\/div>/);
  if (!match?.[1]) return [];
  const data = JSON.parse(decodeHtml(match[1])) as {
    PageBlocks?: Array<{ BlockDocuments?: Array<Record<string, unknown>> }>;
  };
  const docs: CatalogDoc[] = [];
  for (const block of data.PageBlocks ?? []) {
    for (const doc of block.BlockDocuments ?? []) {
      const link = typeof doc.DocumentLink === 'string' ? doc.DocumentLink : '';
      const title = typeof doc.Title === 'string' ? doc.Title : '';
      if (!link || !title) continue;
      const extension = String(doc.DocumentExtension ?? '').toLowerCase();
      docs.push({
        title,
        url: link.startsWith('http') ? link : `${SITE}${link}`,
        extension,
      });
    }
  }
  return docs;
}

export function pickLatest(docs: CatalogDoc[], predicate: (doc: CatalogDoc) => boolean): CatalogDoc | null {
  const matches = docs.filter(predicate);
  matches.sort((a, b) => titleRecencyKey(b.title) - titleRecencyKey(a.title));
  return matches[0] ?? null;
}

export function releaseSlug(title: string): string {
  return title
    .replace(/\s+[–—-]\s+.*$/u, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function releasePageUrl(title: string): string {
  return `${SITE}/information-releases/${releaseSlug(title)}/`;
}

export async function fetchReleaseDate(title: string): Promise<string | null> {
  try {
    const html = await fetchText(releasePageUrl(title), { timeoutMs: 20_000, maxBytes: 2_000_000 });
    const match = html.match(/id="pageViewData" data-value="([\s\S]*?)"><\/div>/);
    if (!match?.[1]) return null;
    const data = JSON.parse(decodeHtml(match[1])) as { PageDate?: string };
    const day = String(data.PageDate ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  } catch {
    return null;
  }
}

export async function fetchCatalog(): Promise<CatalogDoc[]> {
  const html = await fetchText(CATALOG_URL, { timeoutMs: 30_000, maxBytes: 3_000_000 });
  return parseCatalog(html);
}

async function readTable(doc: CatalogDoc): Promise<string> {
  const bytes = await fetchBuffer(doc.url, {
    timeoutMs: 90_000,
    maxBytes: doc.extension === 'csv' ? 40_000_000 : 8_000_000,
  });
  if (doc.extension === 'zip' || doc.url.toLowerCase().endsWith('.zip')) {
    const entries = unzipEntries(bytes);
    const texts: string[] = [];
    for (const [name, body] of entries) {
      if (name.toLowerCase().endsWith('.csv')) {
        texts.push(new TextDecoder('utf-8', { fatal: false }).decode(body));
      }
    }
    return texts.join('\n');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function toDated(points: SeriesPoint[], frequency: Frequency): import('./derive.ts').DatedValue[] {
  const out: import('./derive.ts').DatedValue[] = [];
  for (const point of points) {
    const range = periodFromStatsNz(point.periodRaw, frequency);
    if (!range) continue;
    out.push({
      period: range.period,
      periodStart: range.start,
      periodEnd: range.end,
      value: point.value,
      frequency,
    });
  }
  return out;
}

export async function loadStatsSeries(
  doc: CatalogDoc,
  seriesId: string,
  frequency: Frequency,
): Promise<import('./derive.ts').WithPrevious[]> {
  const text = await readTable(doc);
  const found = collectSeries(text, new Set([seriesId]), STATS_COLUMNS);
  const points = found.get(seriesId) ?? [];
  return attachPrevious(toDated(points, frequency));
}

export async function loadEmploymentGrowth(doc: CatalogDoc): Promise<import('./derive.ts').WithPrevious[]> {
  const text = await readTable(doc);
  const found = collectSeries(text, new Set(['MEIM.S1ZS']), STATS_COLUMNS);
  const levels = toDated(found.get('MEIM.S1ZS') ?? [], 'monthly');
  return attachPrevious(changeOverMonths(levels, 12));
}

export const STATS_SERIES = {
  gdp: 'SNEQ.SG01RSC01B01PC',
  cpi: 'CPIQ.SE9AAC',
  retail: 'RTTQ.SF9KSPC',
  filledJobs: 'MEIM.S1ZS',
} as const;

export function selectStatsDocs(docs: CatalogDoc[]): {
  gdp: CatalogDoc | null;
  cpi: CatalogDoc | null;
  retail: CatalogDoc | null;
  employment: CatalogDoc | null;
  consents: CatalogDoc | null;
} {
  return {
    gdp: pickLatest(
      docs,
      (doc) =>
        /gross domestic product:/i.test(doc.title) &&
        /csv/i.test(doc.title) &&
        !/visual/i.test(doc.title) &&
        !/regional/i.test(doc.title) &&
        doc.extension === 'csv',
    ),
    cpi: pickLatest(
      docs,
      (doc) => /consumers price index:/i.test(doc.title) && /infoshare/i.test(doc.title),
    ),
    retail: pickLatest(
      docs,
      (doc) => /retail trade survey:/i.test(doc.title) && /csv/i.test(doc.title) && doc.extension === 'zip',
    ),
    employment: pickLatest(
      docs,
      (doc) => /employment indicators:/i.test(doc.title) && /csv/i.test(doc.title) && doc.extension === 'zip',
    ),
    consents: pickLatest(
      docs,
      (doc) =>
        /^building consents issued:/i.test(doc.title) &&
        /csv/i.test(doc.title) &&
        doc.extension.toLowerCase() === 'zip',
    ),
  };
}
