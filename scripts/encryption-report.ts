/**
 * KAN-112 / KAN-113: accounts whose data or personal files aren't encrypted yet (they're migrated
 * on the owner's next sign-in or unlock).
 * Run on the server: node --import tsx scripts/encryption-report.ts
 * Prints user id, email, plain values and plain files left; nothing is changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb, queryAll } from '../server/db/index.ts';
import { encryptionEnabled, migrationReport } from '../server/security/fieldCrypto.ts';
import { UPLOADS_DIR, isSealedUpload, personalUploadPaths } from '../server/lib/uploads.ts';

const db = await getDb();
const byUser = new Map<string, { email: string; plainValues: number; plainFiles: number }>();
for (const r of migrationReport(db)) byUser.set(r.userId, { email: r.email, plainValues: r.plainValues, plainFiles: 0 });
for (const u of queryAll<{ id: string; email: string }>(db, `SELECT id, email FROM users`)) {
  let plainFiles = 0;
  for (const rel of personalUploadPaths(db, u.id)) {
    const abs = path.join(UPLOADS_DIR, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile() && !isSealedUpload(fs.readFileSync(abs))) plainFiles++;
  }
  if (plainFiles === 0) continue;
  const row = byUser.get(u.id) ?? { email: u.email, plainValues: 0, plainFiles: 0 };
  row.plainFiles = plainFiles;
  byUser.set(u.id, row);
}
const rows = [...byUser].sort((a, b) => b[1].plainValues + b[1].plainFiles - (a[1].plainValues + a[1].plainFiles));
console.log(`DATA_ENCRYPTION is ${encryptionEnabled() ? 'on' : 'off'}. ${rows.length} account(s) not fully migrated.`);
console.log('user id\temail\tplain values\tplain files');
for (const [id, r] of rows) console.log(`${id}\t${r.email}\t${r.plainValues}\t${r.plainFiles}`);
