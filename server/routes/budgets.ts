import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { seedCategoriesForUser } from '../lib/categories.ts';
import { getDb, queryAll, queryOne, run, newId } from '../db/index.ts';
import {
  categoryTypeIsIncome,
  isCategoryType,
  normalizeCategoryType,
  type CategoryType,
} from '../../src/lib/categoryTypes.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});
function uid(req: { scopeUserId?: string; user?: { id?: string } | null }): string {
  return (req as AuthedRequest & { scopeUserId?: string }).scopeUserId
    || (req as AuthedRequest).user?.id
    || '';
}


function mapBudget(r: Record<string, unknown>) {
  const periodStart = String(r.period_start ?? '');
  return {
    id: r.id,
    categoryId: r.category_id,
    periodStart,
    periodEnd: r.period_end,
    amountNzd: r.amount_nzd,
    notes: r.notes,
    /** YYYY-MM derived from period_start for monthly budget plans */
    yearMonth: periodStart.length >= 7 ? periodStart.slice(0, 7) : null,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseYearMonth(input: unknown): { year: number; month: number; start: string; end: string } | null {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}$/.test(input)) return null;
  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  const start = `${input}-01`;
  const end = `${input}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
  return { year, month, start, end };
}

router.get('/categories', async (req, res) => {
  const db = await getDb();
  const userId = uid(req);
  seedCategoriesForUser(db, userId);
  const rows = queryAll(
    db,
    'SELECT * FROM budget_categories WHERE user_id = ? ORDER BY sort_order, name',
    [userId],
  );
  res.json(rows.map(mapCategory));
});

function mapCategory(r: Record<string, unknown>) {
  const type = normalizeCategoryType(r.type, r.is_income as number | boolean | null);
  return {
    id: r.id,
    slug: r.slug != null ? String(r.slug) : String(r.id),
    name: r.name,
    parentId: r.parent_id,
    colour: r.colour,
    type,
    isIncome: categoryTypeIsIncome(type),
    sortOrder: r.sort_order,
  };
}

function resolveCategoryType(body: Record<string, unknown>, fallbackIsIncome?: unknown): CategoryType {
  if (isCategoryType(body.type)) return body.type;
  if (body.isIncome !== undefined) return normalizeCategoryType(undefined, Boolean(body.isIncome));
  if (fallbackIsIncome !== undefined) return normalizeCategoryType(undefined, fallbackIsIncome as boolean | number);
  return 'spending';
}

function slugCategoryId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base ? `cat-${base}` : newId('cat');
}

/** Create a transaction / budget category. Auth required via /api gate. */
router.post('/categories', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 80) {
    res.status(400).json({ error: 'name is required (1–80 characters)' });
    return;
  }
  const type = resolveCategoryType(b as Record<string, unknown>);
  const isIncome = categoryTypeIsIncome(type);
  const colour = typeof b.colour === 'string' && b.colour.trim() ? b.colour.trim().slice(0, 32) : null;
  const sortOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : (isIncome ? 5 : type.startsWith('transfer') ? 95 : 100);
  const userId = uid(req);
  let id = typeof b.id === 'string' && b.id.trim() ? b.id.trim().slice(0, 64) : slugCategoryId(name);
  // Ensure globally unique id (ids are PK); prefer user-suffixed custom ids
  let attempt = id.includes(userId) ? id : `${id}__${userId}`;
  let n = 0;
  while (queryOne(db, 'SELECT id FROM budget_categories WHERE id=?', [attempt])) {
    n += 1;
    attempt = `${id}-${n}__${userId}`;
    if (n > 50) {
      attempt = newId('cat');
      break;
    }
  }
  id = attempt;
  const parentId =
    typeof b.parentId === 'string' && b.parentId.trim() ? b.parentId.trim() : null;
  if (parentId) {
    const parent = queryOne(
      db,
      'SELECT id FROM budget_categories WHERE id=? AND user_id=?',
      [parentId, userId],
    );
    if (!parent) {
      res.status(400).json({ error: `Unknown parent category: ${parentId}` });
      return;
    }
  }
  const slug =
    typeof b.slug === 'string' && b.slug.trim()
      ? b.slug.trim().slice(0, 64)
      : id;
  run(
    db,
    `INSERT INTO budget_categories (id, user_id, slug, name, parent_id, colour, type, is_income, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, slug, name, parentId, colour, type, isIncome ? 1 : 0, sortOrder],
  );
  const row = queryOne(db, 'SELECT * FROM budget_categories WHERE id=? AND user_id=?', [id, userId])!;
  res.status(201).json(mapCategory(row));
});

router.patch('/categories/:id', async (req, res) => {
  const db = await getDb();
  const id = String(req.params.id ?? '');
  const userId = uid(req);
  const existing = queryOne(db, 'SELECT * FROM budget_categories WHERE id=? AND user_id=?', [id, userId]);
  if (!existing) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }
  const b = req.body ?? {};
  const name =
    b.name !== undefined
      ? (typeof b.name === 'string' ? b.name.trim() : '')
      : String(existing.name ?? '');
  if (!name || name.length > 80) {
    res.status(400).json({ error: 'name is required (1–80 characters)' });
    return;
  }
  const type =
    b.type !== undefined || b.isIncome !== undefined
      ? resolveCategoryType(b as Record<string, unknown>, existing.is_income)
      : normalizeCategoryType(existing.type, existing.is_income as number | boolean | null);
  const isIncome = categoryTypeIsIncome(type) ? 1 : 0;
  const colour =
    b.colour !== undefined
      ? (typeof b.colour === 'string' && b.colour.trim() ? b.colour.trim().slice(0, 32) : null)
      : (existing.colour as string | null);
  const sortOrder =
    b.sortOrder !== undefined && Number.isFinite(Number(b.sortOrder))
      ? Number(b.sortOrder)
      : Number(existing.sort_order ?? 0);
  run(
    db,
    `UPDATE budget_categories SET name=?, colour=?, type=?, is_income=?, sort_order=? WHERE id=? AND user_id=?`,
    [name, colour, type, isIncome, sortOrder, id, userId],
  );
  const row = queryOne(db, 'SELECT * FROM budget_categories WHERE id=? AND user_id=?', [id, userId])!;
  res.json(mapCategory(row));
});

/** Remove a category. Nulls txn/income refs and deletes related budget/income plans (this user only). */
router.delete('/categories/:id', async (req, res) => {
  const db = await getDb();
  const id = String(req.params.id ?? '');
  const userId = uid(req);
  const existing = queryOne(db, 'SELECT * FROM budget_categories WHERE id=? AND user_id=?', [id, userId]);
  if (!existing) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }
  // Re-parent children to null (same user)
  run(db, `UPDATE budget_categories SET parent_id = NULL WHERE parent_id = ? AND user_id = ?`, [id, userId]);
  run(db, `UPDATE transactions SET category_id = NULL WHERE category_id = ? AND user_id = ?`, [id, userId]);
  run(db, `UPDATE income_records SET category_id = NULL WHERE category_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM budgets WHERE category_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM income_plans WHERE category_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM budget_categories WHERE id = ? AND user_id = ?`, [id, userId]);
  res.json({ ok: true, id });
});


/** List budgets. Optional ?month=YYYY-MM filters to plans overlapping that calendar month. */
router.get('/', async (req, res) => {
  const db = await getDb();
  const month = typeof req.query.month === 'string' ? parseYearMonth(req.query.month) : null;
  let rows: Record<string, unknown>[];
  if (month) {
    rows = queryAll(
      db,
      `SELECT * FROM budgets
       WHERE user_id = ? AND period_start <= ? AND period_end >= ?
       ORDER BY period_start DESC, category_id`,
      [uid(req), month.end, month.start],
    );
  } else {
    rows = queryAll(db, 'SELECT * FROM budgets WHERE user_id = ? ORDER BY period_start DESC', [uid(req)]);
  }
  res.json(rows.map(mapBudget));
});

router.post('/', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};
  const id = newId('bud');
  run(
    db,
    `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd, notes) VALUES (?,?,?,?,?,?,?)`,
    [id, uid(req), b.categoryId, b.periodStart, b.periodEnd, Number(b.amountNzd ?? 0), b.notes ?? null],
  );
  const row = queryOne(db, 'SELECT * FROM budgets WHERE id=? AND user_id=?', [id, uid(req)])!;
  res.status(201).json(mapBudget(row));
});

/**
 * Upsert a monthly budget plan for one category.
 * Body: { categoryId, yearMonth: "YYYY-MM", amountNzd, notes? }
 * Stores period_start/end as the full calendar month (Pacific/Auckland date-only).
 */
router.put('/plan', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};
  const categoryId = typeof b.categoryId === 'string' ? b.categoryId.trim() : '';
  if (!categoryId) {
    res.status(400).json({ error: 'categoryId is required' });
    return;
  }
  const cat = queryOne(
    db,
    'SELECT id FROM budget_categories WHERE id=? AND user_id=?',
    [categoryId, uid(req)],
  );
  if (!cat) {
    res.status(400).json({ error: `Unknown category: ${categoryId}` });
    return;
  }
  const month = parseYearMonth(b.yearMonth);
  if (!month) {
    res.status(400).json({ error: 'yearMonth must be YYYY-MM' });
    return;
  }
  const amount = Number(b.amountNzd);
  if (!Number.isFinite(amount) || amount < 0) {
    res.status(400).json({ error: 'amountNzd must be a non-negative number' });
    return;
  }

  // Prefer exact calendar-month row; else any overlapping row for this category.
  let existing = queryOne(
    db,
    `SELECT * FROM budgets WHERE user_id=? AND category_id=? AND period_start=? AND period_end=?`,
    [uid(req), categoryId, month.start, month.end],
  );
  if (!existing) {
    existing = queryOne(
      db,
      `SELECT * FROM budgets
       WHERE user_id=? AND category_id=? AND period_start <= ? AND period_end >= ?
       ORDER BY period_start DESC LIMIT 1`,
      [uid(req), categoryId, month.end, month.start],
    );
  }

  if (existing) {
    run(
      db,
      `UPDATE budgets SET period_start=?, period_end=?, amount_nzd=?, notes=? WHERE id=? AND user_id=?`,
      [month.start, month.end, amount, b.notes ?? existing.notes ?? null, existing.id, uid(req)],
    );
    const row = queryOne(db, 'SELECT * FROM budgets WHERE id=? AND user_id=?', [existing.id, uid(req)])!;
    res.json(mapBudget(row));
    return;
  }

  const id = newId('bud');
  run(
    db,
    `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd, notes) VALUES (?,?,?,?,?,?,?)`,
    [id, uid(req), categoryId, month.start, month.end, amount, b.notes ?? null],
  );
  const row = queryOne(db, 'SELECT * FROM budgets WHERE id=? AND user_id=?', [id, uid(req)])!;
  res.status(201).json(mapBudget(row));
});

router.patch('/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const existing = queryOne(db, 'SELECT * FROM budgets WHERE id=? AND user_id=?', [id, uid(req)]);
  if (!existing) {
    res.status(404).json({ error: 'Budget not found' });
    return;
  }
  const b = req.body ?? {};
  const amount =
    b.amountNzd !== undefined ? Number(b.amountNzd) : Number(existing.amount_nzd);
  if (!Number.isFinite(amount) || amount < 0) {
    res.status(400).json({ error: 'amountNzd must be a non-negative number' });
    return;
  }
  const notes = b.notes !== undefined ? b.notes : existing.notes;
  run(db, `UPDATE budgets SET amount_nzd=?, notes=? WHERE id=?`, [amount, notes ?? null, id]);
  const row = queryOne(db, 'SELECT * FROM budgets WHERE id=? AND user_id=?', [id, uid(req)])!;
  res.json(mapBudget(row));
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const existing = queryOne(db, 'SELECT * FROM budgets WHERE id=? AND user_id=?', [id, uid(req)]);
  if (!existing) {
    res.status(404).json({ error: 'Budget not found' });
    return;
  }
  run(db, 'DELETE FROM budgets WHERE id=? AND user_id=?', [id, uid(req)]);
  res.json({ ok: true, id });
});

export default router;
