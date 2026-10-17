/**
 * The one-off holdings rebuild (cost_basis_nzd NOT NULL → nullable) keeps every column, every row
 * and every index. It used to copy a fixed column list from the first schema, which dropped user_id
 * and every column added since. Run: npm run test:db-migrations
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-holdings-cost-'));
const dbPath = path.join(dataDir, 'portfolio.db');
process.env.DATABASE_PATH = dbPath;
process.env.AUTH_ENCRYPTION_KEY = 'e'.repeat(64);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const now = '2026-10-05T00:00:00.000Z';
let before: { cols: string[]; indexes: string[]; row: Record<string, unknown> };
{
  // Today's schema, except holdings.cost_basis_nzd is NOT NULL DEFAULT 0 as in old databases.
  const SQL = await initSqlJs();
  const old = new SQL.Database();
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8').replace(/^(\s*cost_basis_nzd\s+REAL),/m, '$1 NOT NULL DEFAULT 0,');
  assert(/cost_basis_nzd\s+REAL NOT NULL DEFAULT 0/.test(schema), 'old-style column in the fixture');
  old.exec(schema);
  old.run(`INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES ('pam','pam@example.com','h','Pam','Test',?,?)`, [now, now]);
  // Fill every column so nothing can be dropped unnoticed.
  const cols = old.exec(`PRAGMA table_info(holdings)`)[0].values.map((r) => ({ name: String(r[1]), type: String(r[2]).toUpperCase() }));
  const row: Record<string, unknown> = {};
  for (const c of cols) row[c.name] = c.type.includes('INT') ? 7 : c.type.includes('REAL') ? 12.5 : `v_${c.name}`;
  Object.assign(row, { id: 'hld_1', user_id: 'pam', asset_class: 'collectable', created_at: now, updated_at: now });
  old.run(`INSERT INTO holdings (${cols.map((c) => c.name).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c.name] as string | number));
  const indexes = old.exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'holdings' AND sql IS NOT NULL ORDER BY name`)[0]?.values.map((r) => String(r[0])) ?? [];
  before = { cols: cols.map((c) => c.name), indexes, row };
  fs.writeFileSync(dbPath, Buffer.from(old.export()));
  old.close();
}

try {
  const { getDb, queryOne, run } = await import('./index.ts');
  const db = await getDb();

  const info = db.exec(`PRAGMA table_info(holdings)`)[0];
  const after = info.values.map((r) => String(r[1]));
  for (const c of before.cols) assert(after.includes(c), `column ${c} kept`);
  const cost = info.values.find((r) => r[1] === 'cost_basis_nzd')!;
  assert(Number(cost[3]) === 0, 'cost_basis_nzd is nullable now');

  const row = queryOne<Record<string, unknown>>(db, `SELECT * FROM holdings WHERE id = 'hld_1'`)!;
  for (const c of before.cols) assert(row[c] === before.row[c], `value of ${c} kept (${String(row[c])} vs ${String(before.row[c])})`);

  const indexes = db.exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'holdings' AND sql IS NOT NULL`)[0]?.values.map((r) => String(r[0])) ?? [];
  for (const i of before.indexes) assert(indexes.includes(i), `index ${i} recreated`);
  assert(!db.exec(`SELECT name FROM sqlite_master WHERE name = 'holdings_nullable_cost'`).length, 'no temporary table left');

  run(db, `INSERT INTO holdings (id, user_id, asset_class, name, cost_basis_nzd, created_at, updated_at) VALUES ('hld_2','pam','stock','X',NULL,?,?)`, [now, now]);
  assert(queryOne(db, `SELECT cost_basis_nzd FROM holdings WHERE id = 'hld_2'`)?.cost_basis_nzd === null, 'blank cost stored as NULL');

  console.log('holdings cost rebuild test passed');
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
