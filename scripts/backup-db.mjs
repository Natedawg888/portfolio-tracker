#!/usr/bin/env node
/**
 * Copy sql.js SQLite file to data/backups/ with a timestamp.
 * Never invents data. Safe to run while API is idle; prefer stop/restart around restore.
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
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    '-' +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

if (!fs.existsSync(DB_PATH)) {
  console.error(JSON.stringify({ level: 'error', msg: 'db_missing', path: DB_PATH }));
  process.exit(1);
}
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const dest = path.join(BACKUP_DIR, `portfolio-${stamp()}.db`);
fs.copyFileSync(DB_PATH, dest);
const stat = fs.statSync(dest);
console.log(
  JSON.stringify({
    level: 'info',
    msg: 'db_backup_ok',
    source: DB_PATH,
    dest,
    bytes: stat.size,
    at: new Date().toISOString(),
  }),
);
