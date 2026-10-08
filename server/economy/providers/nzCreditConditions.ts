/**
 * New Zealand credit conditions from the Reserve Bank credit conditions survey,
 * table C60. The published index is already signed so a higher number means
 * easier credit. rbnz.govt.nz returns HTTP 403 to this app, so the same official
 * workbook is downloaded from the Internet Archive's public copy of that file.
 * The latest raw capture is requested directly. The CDX index is only a backup:
 * it is slow, and a failed index lookup used to leave the series empty.
 * Railway cannot reach the Internet Archive either, so a copy of the official
 * workbook ships with the app as the last fallback. Refresh it from a machine
 * that can reach the archive with `npm run economy:c60-snapshot`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quarterOfMonth, quarterRange } from '../periods.ts';
import { attachPrevious, type DatedValue, type WithPrevious } from './derive.ts';
import { fetchDownload, fetchText } from './http.ts';
import { excelSerialToIsoDate, publishedDay } from './housingStarts.ts';
import { readXlsxSheets, type SheetGrid } from './xlsx.ts';

/** Official C60 workbook, March 2018 onward. */
export const RBNZ_C60_URL =
  'https://www.rbnz.govt.nz/-/media/project/sites/rbnz/files/statistics/series/c/c60/hc60.xlsx';

export const RBNZ_C60_PAGE = 'https://www.rbnz.govt.nz/statistics/series/lending-and-monetary/credit-conditions';

/**
 * Credit availability, observed change over the past six months, corporate and
 * institutional loans. This is the survey's business-lending availability index.
 */
export const NZ_CREDIT_SERIES = 'CCS.Q99_AV';

/** Official C60 workbook bundled with the app. */
export const C60_SNAPSHOT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../snapshots/hc60.xlsx');

const ARCHIVE_CDX = 'https://web.archive.org/cdx/search/cdx';

/**
 * 2999 is after any real capture date, so Wayback resolves the newest snapshot.
 * id_ asks for the stored file bytes rather than the HTML replay page.
 */
export function archiveLatestRawUrl(original = RBNZ_C60_URL): string {
  return `https://web.archive.org/web/2999id_/${original}`;
}

export type NzCreditLoad = {
  rates: WithPrevious[];
  publishedAt: string | null;
  /** Page that describes the survey. The workbook URL is in notes when the archive copy is used. */
  sourceUrl: string;
  notes: string;
};

type ArchiveCapture = { timestamp: string; original: string };

/** Where the workbook bytes came from. */
type C60Origin = 'rbnz' | 'archive' | 'snapshot';

export function parseNzCreditAvailability(grid: SheetGrid, seriesId: string): DatedValue[] {
  let headerRow = 0;
  let dateColumn = '';
  let valueColumn = '';
  for (const [rowNumber, row] of grid) {
    let labelColumn = '';
    let seriesColumn = '';
    for (const [column, value] of row) {
      if (value === 'Series Id') labelColumn = column;
      if (value === seriesId) seriesColumn = column;
    }
    if (labelColumn && seriesColumn && labelColumn !== seriesColumn) {
      headerRow = rowNumber;
      dateColumn = labelColumn;
      valueColumn = seriesColumn;
    }
  }
  if (!dateColumn || !valueColumn) {
    throw new Error(`The C60 workbook has no ${seriesId} series.`);
  }

  const out: DatedValue[] = [];
  for (const rowNumber of [...grid.keys()].filter((row) => row > headerRow).sort((a, b) => a - b)) {
    const row = grid.get(rowNumber);
    if (!row) continue;
    const iso = excelSerialToIsoDate(Number(row.get(dateColumn)));
    const value = Number(row.get(valueColumn));
    if (!iso || !Number.isFinite(value)) continue;
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    if (month % 3 !== 0) continue;
    const range = quarterRange(year, quarterOfMonth(month));
    if (range.period < '2012-Q1') continue;
    out.push({
      period: range.period,
      periodStart: range.start,
      periodEnd: range.end,
      value: Math.round(value * 10000) / 10000,
      frequency: 'quarterly',
    });
  }
  return out;
}

/** The Table Description sheet stores the release day as an Excel serial beside "Published Date". */
export function parseC60PublishedDay(grid: SheetGrid | null | undefined): string | null {
  if (!grid) return null;
  for (const row of grid.values()) {
    let labelColumn = '';
    for (const [column, value] of row) {
      if (value === 'Published Date') labelColumn = column;
    }
    if (!labelColumn) continue;
    for (const [column, value] of row) {
      if (column === labelColumn) continue;
      const iso = excelSerialToIsoDate(Number(value));
      if (iso) return iso;
    }
  }
  return null;
}

/**
 * CDX rows are read by column name. A positional read would pair the wrong
 * capture when the archive changes the field order.
 */
export function archiveCaptures(payload: unknown, fileName: string): ArchiveCapture[] {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  const header = payload[0];
  if (!Array.isArray(header)) return [];
  const timestampIndex = header.indexOf('timestamp');
  const originalIndex = header.indexOf('original');
  if (timestampIndex < 0 || originalIndex < 0) return [];
  const found: ArchiveCapture[] = [];
  for (const row of payload.slice(1)) {
    if (!Array.isArray(row)) continue;
    const timestamp = String(row[timestampIndex] ?? '');
    const original = String(row[originalIndex] ?? '');
    if (!/^\d{14}$/.test(timestamp) || !original.endsWith(`/${fileName}`)) continue;
    found.push({ timestamp, original });
  }
  return found.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

function creditNotes(origin: C60Origin, publishedAt: string | null, fromWorkbook: boolean): string {
  const meaning =
    'Published credit-availability index for corporate and institutional loans over the past six months. The Reserve Bank score runs from -100 to 100, and a higher number means easier credit. The survey is six-monthly; each observation is stored on the quarter its date falls in.';
  const fetched =
    origin === 'rbnz'
      ? 'Downloaded from the Reserve Bank C60 workbook.'
      : origin === 'archive'
        ? `rbnz.govt.nz returns HTTP 403 to this app, so the workbook is the Internet Archive copy of the official file ${RBNZ_C60_URL}.`
        : `Neither rbnz.govt.nz nor the Internet Archive could be reached, so this is the copy of the official file ${RBNZ_C60_URL} bundled with the app.`;
  const published = fromWorkbook
    ? 'published_at is the Published Date in the workbook.'
    : publishedAt
      ? 'published_at is the file Last-Modified date.'
      : 'The workbook has no Published Date, so published_at is the period end.';
  return `${meaning} ${fetched} ${published}`;
}

export function workbookFrom(body: Buffer, sourceUrl: string, origin: C60Origin, lastModified: string | null): NzCreditLoad {
  if (body[0] !== 0x50 || body[1] !== 0x4b) {
    throw new Error(`The C60 download from ${sourceUrl} was not a workbook.`);
  }
  const sheets = readXlsxSheets(body);
  const data = sheets.get('Data');
  if (!data) throw new Error('The C60 workbook has no Data sheet.');
  const rates = attachPrevious(parseNzCreditAvailability(data, NZ_CREDIT_SERIES));
  if (rates.length === 0) throw new Error(`The C60 workbook did not include ${NZ_CREDIT_SERIES}.`);
  const fromWorkbook = parseC60PublishedDay(sheets.get('Table Description'));
  const publishedAt = fromWorkbook ?? (origin === 'rbnz' ? publishedDay(lastModified) : null);
  return {
    rates,
    publishedAt,
    sourceUrl: RBNZ_C60_PAGE,
    notes: creditNotes(origin, publishedAt, fromWorkbook != null),
  };
}

async function loadCapture(sourceUrl: string): Promise<NzCreditLoad> {
  const download = await fetchDownload(sourceUrl, { timeoutMs: 20_000, maxBytes: 2_000_000 });
  return workbookFrom(download.body, sourceUrl, 'archive', download.lastModified);
}

/** CDX is the backup when the direct latest-capture URL does not return the workbook. */
async function loadFromArchiveIndex(): Promise<NzCreditLoad> {
  const cdx = new URL(ARCHIVE_CDX);
  cdx.searchParams.set('url', 'www.rbnz.govt.nz/-/media/project/sites/rbnz/files/statistics/series/c/c60/hc60.xlsx');
  cdx.searchParams.set('output', 'json');
  cdx.searchParams.set('fl', 'timestamp,original,statuscode');
  cdx.searchParams.append('filter', 'statuscode:200');
  const payload = JSON.parse(await fetchText(cdx.toString(), { timeoutMs: 20_000, maxBytes: 2_000_000 })) as unknown;
  const captures = archiveCaptures(payload, 'hc60.xlsx');
  if (captures.length === 0) {
    throw new Error('The Internet Archive has no public copy of the RBNZ C60 workbook.');
  }
  let lastError = 'The Internet Archive copy of the C60 workbook was not a workbook.';
  for (const capture of captures.slice(-5).reverse()) {
    const sourceUrl = `https://web.archive.org/web/${capture.timestamp}id_/${capture.original}`;
    try {
      return await loadCapture(sourceUrl);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}

async function loadFromArchive(): Promise<NzCreditLoad> {
  const direct = archiveLatestRawUrl();
  try {
    return await loadCapture(direct);
  } catch (directErr) {
    const directMessage = directErr instanceof Error ? directErr.message : String(directErr);
    try {
      return await loadFromArchiveIndex();
    } catch (indexErr) {
      const indexMessage = indexErr instanceof Error ? indexErr.message : String(indexErr);
      throw new Error(`${directMessage}; ${indexMessage}`);
    }
  }
}

export async function loadNzCreditConditions(): Promise<NzCreditLoad> {
  let message: string;
  try {
    const download = await fetchDownload(RBNZ_C60_URL, { timeoutMs: 20_000, maxBytes: 2_000_000 });
    return workbookFrom(download.body, RBNZ_C60_URL, 'rbnz', download.lastModified);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  let archiveMessage: string;
  try {
    return await loadFromArchive();
  } catch (archiveErr) {
    archiveMessage = archiveErr instanceof Error ? archiveErr.message : String(archiveErr);
  }
  try {
    return workbookFrom(await readFile(C60_SNAPSHOT_PATH), C60_SNAPSHOT_PATH, 'snapshot', null);
  } catch (snapshotErr) {
    const snapshotMessage = snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr);
    throw new Error(
      `The Reserve Bank C60 workbook could not be read (${message}), the Internet Archive copy could not be read (${archiveMessage}), and the bundled copy could not be read (${snapshotMessage}).`,
    );
  }
}
