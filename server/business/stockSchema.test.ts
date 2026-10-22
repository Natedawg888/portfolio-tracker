/**
 * Stock, suppliers, sales, wages and business budget schema (KAN-107): boot creates the tables,
 * the migration is idempotent on new and old databases, the CHECKs hold, and the rows go with
 * their business and with the account.
 * Run: npm run test:business
 *
 * Uses a throwaway sqlite file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPath = path.join(os.tmpdir(), `pt-business-stock-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { default: initSqlJs } = await import('sql.js');
const { getDb, migrateBusinesses, migrateBusinessStock, queryAll, queryOne, run } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { deleteBusiness, tagMoney } = await import('./store.ts');

type Db = Awaited<ReturnType<typeof getDb>>;
type Row = Record<string, string | number | null>;

// Written out here, not read from BUSINESS_STOCK_TABLES, so dropping a table from that list fails below.
const TABLES = [
  'business_stock_items',
  'business_stock_batches',
  'business_stock_adjustments',
  'business_suppliers',
  'business_supplier_invoices',
  'business_supplier_invoice_batches',
  'business_sales',
  'business_sale_lines',
  'business_wage_payments',
  'business_budget_categories',
  'business_budget_plans',
];
const now = '2026-10-05T00:00:00.000Z';

const columns = (db: Db, table: string) => queryAll<{ name: string }>(db, `PRAGMA table_info(${table})`).map((r) => r.name);
const schemaDump = (db: Db) =>
  JSON.stringify(queryAll(db, `SELECT type, name, sql FROM sqlite_master ORDER BY type, name`));

function insert(db: Db, table: string, row: Row): void {
  const keys = Object.keys(row);
  run(db, `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, Object.values(row));
}

function accepts(db: Db, table: string, row: Row, msg: string): void {
  try {
    insert(db, table, row);
  } catch (err) {
    throw new Error(`FAIL: ${msg} (${(err as Error).message})`);
  }
}

function rejects(db: Db, table: string, row: Row, msg: string): void {
  let threw = false;
  try {
    insert(db, table, row);
  } catch {
    threw = true;
  }
  assert(threw, msg);
}

let seq = 0;
const id = (prefix: string) => `${prefix}_${++seq}`;
const scope = (userId: string, businessId: string) => ({ user_id: userId, business_id: businessId });

const item = (u: string, b: string, extra: Row = {}): Row => ({ id: id('itm'), ...scope(u, b), name: 'Honey 500g', created_at: now, updated_at: now, ...extra });
const batch = (u: string, b: string, extra: Row = {}): Row => ({ id: id('bat'), ...scope(u, b), item_id: 'itm', date: '2026-10-01', quantity: 10, unit_cost_nzd: 4.5, created_at: now, ...extra });
const adjustment = (u: string, b: string, extra: Row = {}): Row => ({ id: id('adj'), ...scope(u, b), item_id: 'itm', date: '2026-10-02', kind: 'damage', quantity_lost: 2, reason: 'Dropped jars', created_at: now, ...extra });
const supplier = (u: string, b: string, extra: Row = {}): Row => ({ id: id('sup'), ...scope(u, b), name: 'Jar Co', created_at: now, updated_at: now, ...extra });
const bill = (u: string, b: string, extra: Row = {}): Row => ({
  id: id('sinv'), ...scope(u, b), supplier_id: 'sup', kind: 'stock', invoice_date: '2026-10-01', due_date: '2026-10-20',
  amount_nzd: 100, created_at: now, updated_at: now, ...extra,
});
const billBatch = (u: string, b: string, extra: Row = {}): Row => ({ ...scope(u, b), invoice_id: id('sinv'), batch_id: id('bat'), ...extra });
const sale = (u: string, b: string, extra: Row = {}): Row => ({ id: id('sale'), ...scope(u, b), date: '2026-10-03', created_at: now, updated_at: now, ...extra });
const saleLine = (u: string, b: string, extra: Row = {}): Row => ({ id: id('sl'), ...scope(u, b), sale_id: 'sale', item_id: 'itm', position: 0, quantity: 1, unit_price_nzd: 12, ...extra });
const wage = (u: string, b: string, extra: Row = {}): Row => ({ id: id('wage'), ...scope(u, b), employee_name: 'Aroha', date: '2026-10-04', amount_nzd: 800, created_at: now, ...extra });
const category = (u: string, b: string, extra: Row = {}): Row => ({ id: id('bcat'), ...scope(u, b), name: 'Rent', kind: 'expense', created_at: now, updated_at: now, ...extra });
const plan = (u: string, b: string, extra: Row = {}): Row => ({ id: id('bplan'), ...scope(u, b), category_id: id('bcat'), period: '2026-10', amount_nzd: 500, created_at: now, updated_at: now, ...extra });

const generated = (key: string): Row => ({ receipt_number: key, receipt_number_key: key.toLowerCase(), receipt_issued_at: now, receipt_snapshot_json: '{}' });

try {
  const db = await getDb();

  // ---------------------------------------------------------------- boot
  for (const t of TABLES) {
    assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [t]), `boot creates ${t}`);
    assert((SCOPED_TABLES as readonly string[]).includes(t), `${t} is user-scoped (export, claim and delete)`);
  }
  assert(columns(db, 'transactions').includes('business_category_id'), 'transactions get business_category_id');
  assert(columns(db, 'businesses').includes('receipt_prefix'), 'businesses get receipt_prefix');
  assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_transactions_user_business_category'`), 'boot makes the category index');
  const booted = schemaDump(db);
  migrateBusinessStock(db);
  assert(schemaDump(db) === booted, 'a second run on a booted database changes nothing');

  // ---------------------------------------------------------------- old database
  const SQL = await initSqlJs({ locateFile: (file: string) => path.resolve('node_modules/sql.js/dist', file) });
  const old = new SQL.Database();
  old.exec(fs.readFileSync(fileURLToPath(new URL('../db/schema.sql', import.meta.url)), 'utf8'));
  const bizSql = queryOne<{ sql: string }>(old, `SELECT sql FROM sqlite_master WHERE name = 'businesses'`)!.sql;
  const oldBizSql = bizSql.replace(/^\s*receipt_prefix\s.*\n/m, '');
  assert(oldBizSql !== bizSql, 'old businesses table drops receipt_prefix');
  old.run('DROP TABLE businesses');
  old.run(oldBizSql);
  assert(!columns(old, 'businesses').includes('receipt_prefix') && !columns(old, 'transactions').includes('business_category_id'), 'old database lacks the new columns');
  run(old, `INSERT INTO businesses (id, user_id, name, created_at, updated_at) VALUES ('biz_old', 'u_old', 'Old Apiary', ?, ?)`, [now, now]);
  migrateBusinesses(old);
  migrateBusinessStock(old);
  assert(columns(old, 'transactions').includes('business_category_id'), 'old transactions gain business_category_id');
  assert(queryOne<{ p: string }>(old, `SELECT receipt_prefix AS p FROM businesses WHERE id = 'biz_old'`)?.p === 'RCT-', 'an existing business reads RCT-');
  assert(queryOne(old, `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_transactions_user_business_category'`), 'old database gets the category index');
  const migrated = schemaDump(old);
  migrateBusinessStock(old);
  assert(schemaDump(old) === migrated, 'a second run on a migrated old database changes nothing');
  old.close();

  // ---------------------------------------------------------------- CHECKs
  const u = 'chk_user';
  const b = 'chk_biz';
  const b2 = 'chk_biz_2';

  rejects(db, 'business_stock_items', item(u, b, { unit: 'box' }), 'unit must be each, kg or L');
  accepts(db, 'business_stock_items', item(u, b, { unit: 'kg', sku: 'HNY-500' }), 'kg is a unit');
  rejects(db, 'business_stock_items', item(u, b, { sku: 'hny-500' }), 'SKU is unique in a business, ignoring case');
  accepts(db, 'business_stock_items', item(u, b2, { sku: 'HNY-500' }), 'another business can use the same SKU');
  accepts(db, 'business_stock_items', item(u, b), 'items without a SKU');
  accepts(db, 'business_stock_items', item(u, b), 'don’t collide on the empty SKU');

  rejects(db, 'business_stock_batches', batch(u, b, { unit_cost_nzd: null }), 'a batch needs a unit cost');
  accepts(db, 'business_stock_batches', batch(u, b, { unit_cost_nzd: 0 }), 'a free batch costs 0');

  accepts(db, 'business_stock_adjustments', adjustment(u, b), 'damage with a quantity lost');
  rejects(db, 'business_stock_adjustments', adjustment(u, b, { quantity_lost: 0 }), 'damage must lose something');
  rejects(db, 'business_stock_adjustments', adjustment(u, b, { quantity_lost: null }), 'damage needs the quantity lost');
  rejects(db, 'business_stock_adjustments', adjustment(u, b, { counted_quantity: 5 }), 'damage has no counted quantity');
  accepts(db, 'business_stock_adjustments', adjustment(u, b, { kind: 'recount', quantity_lost: null, counted_quantity: 0 }), 'a recount can find none');
  rejects(db, 'business_stock_adjustments', adjustment(u, b, { kind: 'recount', quantity_lost: null, counted_quantity: -1 }), 'a recount can’t be negative');
  rejects(db, 'business_stock_adjustments', adjustment(u, b, { kind: 'recount', quantity_lost: 2, counted_quantity: 5 }), 'a recount has no quantity lost');
  rejects(db, 'business_stock_adjustments', adjustment(u, b, { kind: 'recount', quantity_lost: null }), 'a recount needs the counted quantity');
  rejects(db, 'business_stock_adjustments', adjustment(u, b, { reason: '   ' }), 'an adjustment needs a reason');

  accepts(db, 'business_supplier_invoices', bill(u, b, { delivery_nzd: 15, delivery_treatment: 'expense' }), 'goods bill with a freight line');
  rejects(db, 'business_supplier_invoices', bill(u, b, { delivery_treatment: 'ignore' }), 'treatment is capitalise or expense');
  rejects(db, 'business_supplier_invoices', bill(u, b, { kind: 'goods' }), 'kind is stock or delivery');
  rejects(db, 'business_supplier_invoices', bill(u, b, { delivery_nzd: 101 }), 'freight can’t exceed the bill');
  rejects(db, 'business_supplier_invoices', bill(u, b, { delivery_nzd: -1 }), 'freight can’t be negative');
  rejects(db, 'business_supplier_invoices', bill(u, b, { kind: 'delivery', delivery_nzd: 40 }), 'a delivery bill is all freight');
  accepts(db, 'business_supplier_invoices', bill(u, b, { kind: 'delivery', delivery_nzd: 100 }), 'delivery bill');
  rejects(db, 'business_supplier_invoices', bill(u, b, { transaction_id: 'txn_pay' }), 'a bank payment means it was paid');
  accepts(db, 'business_supplier_invoices', bill(u, b, { transaction_id: 'txn_pay', paid_on: '2026-10-10' }), 'paid by a bank debit');
  accepts(db, 'business_supplier_invoices', bill(u, b, { transaction_id: 'txn_pay', paid_on: '2026-10-10' }), 'one debit can pay two bills');

  accepts(db, 'business_sales', sale(u, b, { receipt_path: 'sale-receipts/a.pdf' }), 'uploaded receipt');
  accepts(db, 'business_sales', sale(u, b, generated('RCT-0001')), 'generated receipt');
  rejects(db, 'business_sales', sale(u, b, { receipt_path: 'sale-receipts/b.pdf', ...generated('RCT-0002') }), 'a receipt is uploaded or generated, not both');
  rejects(db, 'business_sales', sale(u, b, { receipt_number: 'RCT-0003', receipt_issued_at: now }), 'a receipt number needs its key');
  rejects(db, 'business_sales', sale(u, b2, generated('rct-0001')), 'receipt numbers are unique per user');
  rejects(db, 'business_sales', sale(u, b, { invoice_id: 'inv_1', transaction_id: 'txn_dep' }), 'an invoiced sale counts money through the invoice, not a deposit');
  accepts(db, 'business_sales', sale(u, b, { invoice_id: 'inv_1' }), 'invoiced sale');
  accepts(db, 'business_sales', sale(u, b, { transaction_id: 'txn_dep' }), 'sale paid by a deposit');
  accepts(db, 'business_sales', sale(u, b, { transaction_id: 'txn_dep' }), 'two sales can share one deposit');

  rejects(db, 'business_sale_lines', saleLine(u, b, { quantity: 0 }), 'a line sells something');
  rejects(db, 'business_wage_payments', wage(u, b, { amount_nzd: 0 }), 'a wage payment is positive');
  accepts(db, 'business_wage_payments', wage(u, b, { employee_id: null }), 'a wage payment outlives its employee');

  rejects(db, 'business_budget_categories', category(u, b, { role: 'sales', kind: 'expense' }), 'sales is income');
  rejects(db, 'business_budget_categories', category(u, b, { role: 'stock', kind: 'income' }), 'stock is an expense');
  rejects(db, 'business_budget_categories', category(u, b, { role: 'rent' }), 'rent is not a role');
  rejects(db, 'business_budget_categories', category(u, b, { plan_cadence: 'week' }), 'plans are per month or year');
  accepts(db, 'business_budget_categories', category(u, b, { role: 'stock' }), 'stock role');
  rejects(db, 'business_budget_categories', category(u, b, { role: 'stock', name: 'Stock 2' }), 'one category per role per business');
  accepts(db, 'business_budget_categories', category(u, b2, { role: 'stock' }), 'another business has its own stock category');
  accepts(db, 'business_budget_categories', category(u, b, { kind: 'income' }), 'a user category can be income');
  accepts(db, 'business_budget_categories', category(u, b), 'user categories have no role');
  accepts(db, 'business_budget_categories', category(u, b), 'and there can be several');

  accepts(db, 'business_budget_plans', plan(u, b, { category_id: 'bcat_plan', period: '2026-10' }), 'month plan');
  accepts(db, 'business_budget_plans', plan(u, b, { category_id: 'bcat_plan', period: '2027' }), 'tax-year plan');
  rejects(db, 'business_budget_plans', plan(u, b, { category_id: 'bcat_plan', period: '2026-10' }), 'one plan per category per period');
  rejects(db, 'business_budget_plans', plan(u, b, { period: 'Oct 2026' }), 'period is YYYY-MM or YYYY');

  // ---------------------------------------------------------------- deleteBusiness and account delete
  const userA = 'stock_user_a';
  const userB = 'stock_user_b';
  const [a1, a2, b1] = ['biz_a1', 'biz_a2', 'biz_b1'];
  for (const [bizId, owner] of [[a1, userA], [a2, userA], [b1, userB]]) {
    run(db, `INSERT INTO businesses (id, user_id, name, created_at, updated_at) VALUES (?,?,?,?,?)`, [bizId, owner, bizId, now, now]);
  }
  const seed = (owner: string, bizId: string) => {
    insert(db, 'business_stock_items', item(owner, bizId));
    insert(db, 'business_stock_batches', batch(owner, bizId));
    insert(db, 'business_stock_adjustments', adjustment(owner, bizId));
    insert(db, 'business_suppliers', supplier(owner, bizId));
    insert(db, 'business_supplier_invoices', bill(owner, bizId));
    insert(db, 'business_supplier_invoice_batches', billBatch(owner, bizId));
    insert(db, 'business_sales', sale(owner, bizId));
    insert(db, 'business_sale_lines', saleLine(owner, bizId));
    insert(db, 'business_wage_payments', wage(owner, bizId));
    insert(db, 'business_budget_categories', category(owner, bizId));
    insert(db, 'business_budget_plans', plan(owner, bizId));
  };
  seed(userA, a1);
  seed(userA, a2);
  seed(userB, b1);
  const count = (table: string, owner: string, bizId?: string) =>
    Number(
      queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM ${table} WHERE user_id = ?${bizId ? ' AND business_id = ?' : ''}`, bizId ? [owner, bizId] : [owner])?.c ?? 0,
    );
  for (const t of TABLES) assert(count(t, userA, a1) === 1 && count(t, userA, a2) === 1 && count(t, userB, b1) === 1, `${t} seeded`);

  const txn = (txnId: string, owner: string, bizId: string, categoryId: string) =>
    run(db, `INSERT INTO transactions (id, user_id, date, amount, created_at, business_id, business_category_id) VALUES (?,?,?,?,?,?,?)`, [
      txnId, owner, '2026-10-06', -50, now, bizId, categoryId,
    ]);
  const txnRow = (txnId: string) => queryOne<{ business_id: string | null; business_category_id: string | null }>(db, `SELECT business_id, business_category_id FROM transactions WHERE id = ?`, [txnId]);

  txn('txn_same', userA, a1, 'bcat_rent_a1');
  assert(tagMoney(db, userA, 'transaction', 'txn_same', a1).ok && txnRow('txn_same')?.business_category_id === 'bcat_rent_a1', 'retagging to the same business keeps the category');
  txn('txn_move', userA, a1, 'bcat_rent_a1');
  assert(tagMoney(db, userA, 'transaction', 'txn_move', a2).ok, 'move to another business');
  assert(txnRow('txn_move')?.business_id === a2 && txnRow('txn_move')?.business_category_id === null, 'moving drops the old business’s category');
  txn('txn_untag', userA, a1, 'bcat_rent_a1');
  assert(tagMoney(db, userA, 'transaction', 'txn_untag', null).ok, 'untag');
  assert(txnRow('txn_untag')?.business_id === null && txnRow('txn_untag')?.business_category_id === null, 'untagging drops the category');

  txn('txn_a2', userA, a2, 'bcat_rent_a2');
  const deleted = deleteBusiness(db, userA, a1);
  assert(deleted.ok, 'business deleted');
  for (const t of TABLES) {
    assert(count(t, userA, a1) === 0, `${t}: deleting the business removes its rows`);
    assert(count(t, userA, a2) === 1, `${t}: the user’s other business keeps its rows`);
    assert(count(t, userB, b1) === 1, `${t}: another user’s rows are untouched`);
  }
  assert(txnRow('txn_same')?.business_id === null && txnRow('txn_same')?.business_category_id === null, 'deleting the business untags its transactions and clears their category');
  assert(txnRow('txn_a2')?.business_category_id === 'bcat_rent_a2', 'the other business’s transaction keeps its category');

  const wiped = deleteScopedDataForUser(db, userA);
  for (const t of TABLES) {
    assert(count(t, userA) === 0, `${t}: account delete removes the user’s rows`);
    assert(wiped.tables[t] === 1, `${t}: account delete counts the rows it removed`);
    assert(count(t, userB) === 1, `${t}: account delete leaves another user alone`);
  }

  console.log('business stock schema tests passed');
} finally {
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
