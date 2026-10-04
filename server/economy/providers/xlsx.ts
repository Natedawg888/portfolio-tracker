/**
 * Enough of an xlsx reader for the small Stats NZ workbooks.
 * Shared strings and inline strings only. No styles, dates, or formulas.
 */
import { decodeHtml } from './http.ts';
import { unzipEntries } from './zip.ts';

export type SheetGrid = Map<number, Map<string, string>>;

export function readXlsxSheets(buffer: Buffer): Map<string, SheetGrid> {
  const entries = unzipEntries(buffer);
  const strings = sharedStrings(entries.get('xl/sharedStrings.xml'));
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    targets.set(match[1]!, match[2]!);
  }
  const sheets = new Map<string, SheetGrid>();
  for (const match of workbook.matchAll(/<sheet\s+([^>]+)>/g)) {
    const attrs = match[1] ?? '';
    const name = attrs.match(/name="([^"]+)"/)?.[1];
    const id = attrs.match(/\br:id="([^"]+)"/)?.[1];
    if (!name || !id) continue;
    const target = targets.get(id);
    if (!target) continue;
    const path = target.startsWith('xl/') ? target : `xl/${target.replace(/^\//, '')}`;
    const xml = entries.get(path)?.toString('utf8');
    if (!xml) continue;
    sheets.set(decodeHtml(name), readSheet(xml, strings));
  }
  return sheets;
}

export function sheetWithCell(sheets: Map<string, SheetGrid>, value: string): SheetGrid | null {
  for (const grid of sheets.values()) {
    for (const row of grid.values()) {
      for (const cell of row.values()) {
        if (cell === value) return grid;
      }
    }
  }
  return null;
}

function sharedStrings(xml: Buffer | undefined): string[] {
  if (!xml) return [];
  const text = xml.toString('utf8');
  return [...text.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    const parts = [...match[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeHtml(part[1] ?? ''));
    return parts.join('');
  });
}

function readSheet(xml: string, strings: string[]): SheetGrid {
  const grid: SheetGrid = new Map();
  for (const match of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const column = match[1]!;
    const rowNumber = Number(match[2]);
    const attrs = match[3] ?? '';
    const inner = match[4] ?? '';
    const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    let value = '';
    if (/t="s"/.test(attrs) && raw != null) value = strings[Number(raw)] ?? '';
    else if (/t="inlineStr"/.test(attrs)) {
      value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeHtml(part[1] ?? '')).join('');
    } else if (raw != null) value = raw;
    if (!value) continue;
    const row = grid.get(rowNumber) ?? new Map<string, string>();
    row.set(column, value.trim());
    grid.set(rowNumber, row);
  }
  return grid;
}
