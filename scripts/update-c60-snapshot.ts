/**
 * Refresh the bundled RBNZ C60 workbook (server/economy/snapshots/hc60.xlsx).
 * Railway cannot reach rbnz.govt.nz or the Internet Archive, so the app falls back to this copy.
 * Run from a machine that can reach the archive, after each six-monthly survey release:
 *   npm run economy:c60-snapshot
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchDownload } from '../server/economy/providers/http.ts';
import {
  archiveLatestRawUrl,
  C60_SNAPSHOT_PATH,
  RBNZ_C60_URL,
  workbookFrom,
} from '../server/economy/providers/nzCreditConditions.ts';

async function download(): Promise<{ body: Buffer; url: string; load: ReturnType<typeof workbookFrom> }> {
  for (const url of [RBNZ_C60_URL, archiveLatestRawUrl()]) {
    try {
      const { body } = await fetchDownload(url, { timeoutMs: 60_000, maxBytes: 2_000_000 });
      return { body, url, load: workbookFrom(body, url, 'archive', null) };
    } catch (err) {
      console.warn(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error('No copy of the C60 workbook could be downloaded.');
}

const { body, url, load } = await download();
await mkdir(path.dirname(C60_SNAPSHOT_PATH), { recursive: true });
await writeFile(C60_SNAPSHOT_PATH, body);
const latest = load.rates.at(-1);
console.log(
  `Wrote ${C60_SNAPSHOT_PATH} from ${url}: ${load.rates.length} readings, latest ${latest?.period} = ${latest?.value}, published ${load.publishedAt ?? 'unknown'}.`,
);
