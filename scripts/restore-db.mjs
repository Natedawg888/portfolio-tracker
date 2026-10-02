#!/usr/bin/env node
/**
 * Restore portfolio.db from a backup file. Stop the API first.
 * Usage: node scripts/restore-db.mjs data/backups/portfolio-....db
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATABASE_PATH
  ? path.dirname(path.resolve(process.env.DATABASE_PATH))
  : path.join(ROOT, 'data');
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(DATA_DIR, 'portfolio.db');

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/restore-db.mjs <backup.db>');
  process.exit(1);
}
const abs = path.resolve(src);
if (!fs.existsSync(abs)) {
  console.error(JSON.stringify({ level: 'error', msg: 'backup_missing', path: abs }));
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const bakLive = DB_PATH + '.pre-restore-' + Date.now();
if (fs.existsSync(DB_PATH)) {
  fs.copyFileSync(DB_PATH, bakLive);
}
fs.copyFileSync(abs, DB_PATH);
console.log(
  JSON.stringify({
    level: 'info',
    msg: 'db_restore_ok',
    source: abs,
    dest: DB_PATH,
    previousSavedAs: fs.existsSync(bakLive) ? bakLive : null,
    at: new Date().toISOString(),
  }),
);
