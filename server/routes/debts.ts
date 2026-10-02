/**
 * Debt / I-owe tracking — person or corporation creditors + repayments (NZD).
 * Repayments dated on/after 2026-10-01. Never invent balances.
 * Outstanding balances reduce net worth; spend charts only count repayments / cat-debt txns.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb, queryAll, queryOne, run, newId } from '../db/index.ts';

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

const SPENDING_FLOOR = '2026-10-01';
const DEBT_CATEGORY_ID = 'cat-debt';

function normaliseKind(raw: unknown): 'person' | 'corporation' {
  const k = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (k === 'corporation' || k === 'company' || k === 'corp') return 'corporation';
  return 'person';
}

function mapPerson(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    name: r.name as string,
    kind: normaliseKind(r.kind),
    notes: (r.notes as string | null) ?? null,
    outstandingNzd: Number(r.outstanding_nzd ?? 0),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    repaidTotalNzd:
      r.repaid_total != null ? Number(r.repaid_total) : undefined,
  };
}

function mapRepayment(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    personId: r.person_id as string,
    personName: (r.person_name as string | null) ?? null,
    amountNzd: Number(r.amount_nzd ?? 0),
    date: r.date as string,
    notes: (r.notes as string | null) ?? null,
    transactionId: (r.transaction_id as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/** List people owed, with optional repaid totals. */
router.get('/people', async (req, res) => {
  const db = await getDb();
  const rows = queryAll(
    db,
    `SELECT p.*,
       COALESCE((SELECT SUM(r.amount_nzd) FROM debt_repayments r WHERE r.person_id = p.id), 0) AS repaid_total
     FROM debt_people p
     WHERE p.user_id = ?
     ORDER BY p.outstanding_nzd DESC, p.name ASC`,
    [uid(req)],
  );
  res.json(rows.map(mapPerson));
});

/** Summary: current outstanding + optional year filter on repayments. */
router.get('/summary', async (req, res) => {
  const db = await getDb();
  const yearRaw = typeof req.query.year === 'string' ? req.query.year : '';
  const year = /^\d{4}$/.test(yearRaw) ? yearRaw : null;

  const people = queryAll<{ outstanding_nzd?: number; kind?: string }>(
    db,
    `SELECT outstanding_nzd, kind FROM debt_people WHERE user_id = ?`,
    [uid(req)],
  );
  const outstandingTotalNzd = people.reduce(
    (s, p) => s + Number(p.outstanding_nzd ?? 0),
    0,
  );
  const personCount = people.length;
  const personKindCount = people.filter((p) => normaliseKind(p.kind) === 'person').length;
  const corporationCount = people.filter((p) => normaliseKind(p.kind) === 'corporation').length;

  let repaidSql = `SELECT COALESCE(SUM(r.amount_nzd), 0) AS total
    FROM debt_repayments r
    JOIN debt_people p ON p.id = r.person_id
    WHERE p.user_id = ?`;
  const repaidParams: string[] = [uid(req)];
  if (year) {
    repaidSql += ` AND r.date >= ? AND r.date <= ?`;
    repaidParams.push(`${year}-01-01`, `${year}-12-31`);
  }
  const repaidRow = queryOne<{ total?: number }>(db, repaidSql, repaidParams);
  const repaidTotalNzd = Number(repaidRow?.total ?? 0);

  res.json({
    outstandingTotalNzd,
    personCount,
    personKindCount,
    corporationCount,
    repaidTotalNzd,
    year: year ? Number(year) : null,
    asOf: new Date().toISOString(),
  });
});

router.post('/people', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const kind = normaliseKind(b.kind ?? b.type);
  const outstanding = Number(b.outstandingNzd ?? 0);
  if (!Number.isFinite(outstanding) || outstanding < 0) {
    res.status(400).json({ error: 'outstandingNzd must be a non-negative number' });
    return;
  }
  const now = new Date().toISOString();
  const id = newId('debt');
  run(
    db,
    `INSERT INTO debt_people (id, user_id, name, kind, notes, outstanding_nzd, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      id,
      uid(req),
      name,
      kind,
      typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null,
      outstanding,
      now,
      now,
    ],
  );
  const row = queryOne(db, 'SELECT * FROM debt_people WHERE id=? AND user_id=?', [id, uid(req)])!;
  res.status(201).json(mapPerson(row));
});

router.patch('/people/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const existing = queryOne(db, 'SELECT * FROM debt_people WHERE id=? AND user_id=?', [id, uid(req)]);
  if (!existing) {
    res.status(404).json({ error: 'Creditor not found' });
    return;
  }
  const b = req.body ?? {};
  const name =
    typeof b.name === 'string' && b.name.trim()
      ? b.name.trim()
      : (existing.name as string);
  const notes =
    b.notes === null
      ? null
      : typeof b.notes === 'string'
        ? b.notes.trim() || null
        : (existing.notes as string | null);
  const kind =
    b.kind !== undefined || b.type !== undefined
      ? normaliseKind(b.kind ?? b.type)
      : normaliseKind(existing.kind);
  let outstanding = Number(existing.outstanding_nzd ?? 0);
  if (b.outstandingNzd !== undefined) {
    outstanding = Number(b.outstandingNzd);
    if (!Number.isFinite(outstanding) || outstanding < 0) {
      res.status(400).json({ error: 'outstandingNzd must be a non-negative number' });
      return;
    }
  }
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE debt_people SET name=?, kind=?, notes=?, outstanding_nzd=?, updated_at=? WHERE id=?`,
    [name, kind, notes, outstanding, now, id],
  );
  const row = queryOne(db, 'SELECT * FROM debt_people WHERE id=? AND user_id=?', [id, uid(req)])!;
  res.json(mapPerson(row));
});

router.delete('/people/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const existing = queryOne(db, 'SELECT id FROM debt_people WHERE id=?', [id]);
  if (!existing) {
    res.status(404).json({ error: 'Creditor not found' });
    return;
  }
  run(db, 'DELETE FROM debt_repayments WHERE person_id=?', [id]);
  run(db, 'DELETE FROM debt_people WHERE id=? AND user_id=?', [id, uid(req)]);
  res.json({ ok: true, id });
});

/** Repayments list — optional personId, from, to (YYYY-MM-DD). */
router.get('/repayments', async (req, res) => {
  // scoped via person join below
  const db = await getDb();
  const personId = typeof req.query.personId === 'string' ? req.query.personId : null;
  const from = typeof req.query.from === 'string' ? req.query.from : null;
  const to = typeof req.query.to === 'string' ? req.query.to : null;
  const yearRaw = typeof req.query.year === 'string' ? req.query.year : '';
  const year = /^\d{4}$/.test(yearRaw) ? yearRaw : null;

  const clauses: string[] = ['p.user_id = ?'];
  const params: unknown[] = [uid(req)];
  if (personId) {
    clauses.push('r.person_id = ?');
    params.push(personId);
  }
  if (year) {
    clauses.push('r.date >= ? AND r.date <= ?');
    params.push(`${year}-01-01`, `${year}-12-31`);
  } else {
    if (from) {
      clauses.push('r.date >= ?');
      params.push(from);
    }
    if (to) {
      clauses.push('r.date <= ?');
      params.push(to);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = queryAll(
    db,
    `SELECT r.*, p.name AS person_name
     FROM debt_repayments r
     JOIN debt_people p ON p.id = r.person_id
     ${where}
     ORDER BY r.date DESC, r.created_at DESC`,
    params,
  );
  res.json(rows.map(mapRepayment));
});

router.post('/people/:id/repayments', async (req, res) => {
  const db = await getDb();
  const personId = req.params.id;
  const person = queryOne(db, 'SELECT * FROM debt_people WHERE id=? AND user_id=?', [personId, uid(req)]);
  if (!person) {
    res.status(404).json({ error: 'Creditor not found' });
    return;
  }
  const b = req.body ?? {};
  const amount = Number(b.amountNzd ?? b.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'amountNzd must be a positive number' });
    return;
  }
  const date = typeof b.date === 'string' ? b.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  if (date < SPENDING_FLOOR) {
    res.status(400).json({
      error: `Repayment date must be on/after ${SPENDING_FLOOR}`,
    });
    return;
  }

  let transactionId: string | null = null;
  if (b.transactionId != null && b.transactionId !== '') {
    const txnId = String(b.transactionId);
    const txn = queryOne(db, 'SELECT id FROM transactions WHERE id=?', [txnId]);
    if (!txn) {
      res.status(400).json({ error: 'Linked transaction not found' });
      return;
    }
    transactionId = txnId;
    // Categorise linked txn as Debt so it counts in spend charts
    run(db, `UPDATE transactions SET category_id=? WHERE id=?`, [
      DEBT_CATEGORY_ID,
      transactionId,
    ]);
  }

  const now = new Date().toISOString();
  const id = newId('drepay');
  run(
    db,
    `INSERT INTO debt_repayments (id, person_id, amount_nzd, date, notes, transaction_id, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      id,
      personId,
      amount,
      date,
      typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null,
      transactionId,
      now,
    ],
  );

  const prev = Number(person.outstanding_nzd ?? 0);
  const nextOutstanding = Math.max(0, prev - amount);
  run(
    db,
    `UPDATE debt_people SET outstanding_nzd=?, updated_at=? WHERE id=?`,
    [nextOutstanding, now, personId],
  );

  const row = queryOne(
    db,
    `SELECT r.*, p.name AS person_name
     FROM debt_repayments r
     JOIN debt_people p ON p.id = r.person_id
     WHERE r.id=?`,
    [id],
  )!;
  const updatedPerson = queryOne(db, 'SELECT * FROM debt_people WHERE id=? AND user_id=?', [personId, uid(req)])!;
  res.status(201).json({
    repayment: mapRepayment(row),
    person: mapPerson(updatedPerson),
  });
});

router.delete('/repayments/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const existing = queryOne<{ person_id?: string; amount_nzd?: number }>(
    db,
    'SELECT * FROM debt_repayments WHERE id=?',
    [id],
  );
  if (!existing) {
    res.status(404).json({ error: 'Repayment not found' });
    return;
  }
  const personId = String(existing.person_id);
  const amount = Number(existing.amount_nzd ?? 0);
  run(db, 'DELETE FROM debt_repayments WHERE id=?', [id]);
  // Restore outstanding (never invent — reverse the recorded amount)
  const person = queryOne<{ outstanding_nzd?: number }>(
    db,
    'SELECT outstanding_nzd FROM debt_people WHERE id=?',
    [personId],
  );
  if (person) {
    const now = new Date().toISOString();
    const restored = Number(person.outstanding_nzd ?? 0) + amount;
    run(
      db,
      `UPDATE debt_people SET outstanding_nzd=?, updated_at=? WHERE id=?`,
      [restored, now, personId],
    );
  }
  res.json({ ok: true, id });
});

export default router;
export { DEBT_CATEGORY_ID, SPENDING_FLOOR };
