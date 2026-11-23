/**
 * KAN-112: accounts whose notes aren't encrypted yet (they're migrated on their next sign-in).
 * Run on the server: node --import tsx scripts/encryption-report.ts
 * Prints user id, email and how many plain values are left; nothing is changed.
 */
import { getDb } from '../server/db/index.ts';
import { encryptionEnabled, migrationReport } from '../server/security/fieldCrypto.ts';

const db = await getDb();
const rows = migrationReport(db);
console.log(`DATA_ENCRYPTION is ${encryptionEnabled() ? 'on' : 'off'}. ${rows.length} account(s) not fully migrated.`);
for (const r of rows) console.log(`${r.userId}\t${r.email}\t${r.plainValues}`);
