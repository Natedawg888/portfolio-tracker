/** Minimal CSV reader. Keeps quoted commas and escaped quotes. */

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

export function columnIndex(headers: string[], names: string[]): number {
  const lower = headers.map((header) => header.trim().toLowerCase());
  for (const name of names) {
    const index = lower.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!text || text === '..' || text === '...' || text === '*') return null;
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

export type SeriesPoint = { periodRaw: string; value: number };

/** Pull selected series out of a Stats NZ or OECD CSV without keeping every row. */
export function collectSeries(
  text: string,
  wanted: Set<string>,
  columns: { id: string[]; period: string[]; value: string[] },
): Map<string, SeriesPoint[]> {
  const table = parseCsvRows(text);
  const out = new Map<string, SeriesPoint[]>();
  if (table.length === 0) return out;
  const headers = table[0] ?? [];
  const idIndex = columnIndex(headers, columns.id);
  const periodIndex = columnIndex(headers, columns.period);
  const valueIndex = columnIndex(headers, columns.value);
  if (idIndex < 0 || periodIndex < 0 || valueIndex < 0) return out;
  for (let i = 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    const id = (cells[idIndex] ?? '').trim();
    if (!wanted.has(id)) continue;
    const value = parseNumber(cells[valueIndex]);
    const periodRaw = (cells[periodIndex] ?? '').trim();
    if (value == null || !periodRaw) continue;
    const list = out.get(id) ?? [];
    list.push({ periodRaw, value });
    out.set(id, list);
  }
  return out;
}
