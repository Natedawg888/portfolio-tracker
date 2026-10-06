/**
 * Read-only crypto wallets (public addresses only) — per user, isolated.
 * Validates addresses per network and rejects anything that looks like a
 * seed phrase or private key. Never logs or echoes submitted secrets.
 * Balances are not stored here; status / last_synced are owned by the sync job.
 */
import { Router, type Response } from 'express';
import type { Database } from 'sql.js';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import {
  WALLET_NETWORKS,
  SECRET_MESSAGES,
  detectSecret,
  parseWalletNetwork,
  validateWalletAddress,
  type WalletNetwork,
} from '../lib/walletAddress.ts';
import { getDb, queryAll, queryOne, run, newId } from '../db/index.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});
function uid(req: unknown): string {
  return (req as { scopeUserId?: string }).scopeUserId ?? '';
}

const NAME_MAX = 80;

function mapWallet(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    name: r.name as string,
    network: r.network as WalletNetwork,
    address: r.address as string,
    status: r.status as string,
    statusMessage: (r.status_message as string | null) ?? null,
    lastSynced: (r.last_synced as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

type Problem = { status: number; error: string; code: string };

/** Validate the name field; empty / null / omitted → "<Network> wallet". */
function parseName(raw: unknown, network: WalletNetwork): { name: string } | Problem {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
    return { name: `${WALLET_NETWORKS[network].label} wallet` };
  }
  if (typeof raw !== 'string') return { status: 400, error: 'name must be a string', code: 'INVALID_NAME' };
  const name = raw.trim();
  if (name.length > NAME_MAX) {
    return { status: 400, error: `name must be ${NAME_MAX} characters or fewer`, code: 'INVALID_NAME' };
  }
  return { name };
}

function parseAddress(network: WalletNetwork, raw: unknown): { address: string } | Problem {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { status: 400, error: 'address is required', code: 'INVALID_ADDRESS' };
  }
  const r = validateWalletAddress(network, raw);
  if (r.ok) return { address: r.address };
  return { status: 400, error: r.error, code: r.secret ? 'SECRET_REJECTED' : 'INVALID_ADDRESS' };
}

function networkProblem(): Problem {
  return {
    status: 400,
    error: `network must be one of: ${Object.keys(WALLET_NETWORKS).join(', ')}`,
    code: 'INVALID_NETWORK',
  };
}

function isProblem(v: object): v is Problem {
  return 'error' in v;
}

/**
 * Single secret check for every submitted text field, run before any other validation
 * so a key pasted anywhere gets the "never share this" message. Never echoes the input.
 */
function secretProblem(body: Record<string, unknown>): Problem | null {
  for (const field of ['address', 'name'] as const) {
    const v = body[field];
    if (typeof v !== 'string') continue;
    const secret = detectSecret(v, field);
    if (secret) return { status: 400, error: SECRET_MESSAGES[secret], code: 'SECRET_REJECTED' };
  }
  return null;
}

function isDuplicate(
  db: Database,
  userId: string,
  network: string,
  address: string,
  exceptId = '',
): boolean {
  return Boolean(
    queryOne(
      db,
      `SELECT id FROM wallets WHERE user_id=? AND network=? AND address=? AND id != ?`,
      [userId, network, address, exceptId],
    ),
  );
}

function send(res: Response, p: Problem): void {
  res.status(p.status).json({ error: p.error, code: p.code });
}

router.get('/', async (req, res) => {
  const db = await getDb();
  const rows = queryAll(
    db,
    `SELECT * FROM wallets WHERE user_id = ? ORDER BY created_at ASC`,
    [uid(req)],
  );
  res.json(rows.map(mapWallet));
});

router.get('/:id', async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM wallets WHERE id=? AND user_id=?', [req.params.id, uid(req)]);
  if (!row) {
    res.status(404).json({ error: 'Wallet not found' });
    return;
  }
  res.json(mapWallet(row));
});

router.post('/', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};
  const secret = secretProblem(b);
  if (secret) return send(res, secret);

  const network = parseWalletNetwork(b.network);
  if (!network) return send(res, networkProblem());
  const addr = parseAddress(network, b.address);
  if (isProblem(addr)) return send(res, addr);
  const n = parseName(b.name, network);
  if (isProblem(n)) return send(res, n);

  if (isDuplicate(db, uid(req), network, addr.address)) {
    return send(res, { status: 409, error: 'You have already added this wallet', code: 'DUPLICATE_WALLET' });
  }

  const now = new Date().toISOString();
  const id = newId('wallet');
  run(
    db,
    `INSERT INTO wallets (id, user_id, name, network, address, status, status_message, last_synced, created_at, updated_at)
     VALUES (?,?,?,?,?,'connected',NULL,NULL,?,?)`,
    [id, uid(req), n.name, network, addr.address, now, now],
  );
  const row = queryOne(db, 'SELECT * FROM wallets WHERE id=? AND user_id=?', [id, uid(req)])!;
  res.status(201).json(mapWallet(row));
});

router.patch('/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const existing = queryOne(db, 'SELECT * FROM wallets WHERE id=? AND user_id=?', [id, uid(req)]);
  if (!existing) {
    res.status(404).json({ error: 'Wallet not found' });
    return;
  }
  const b = req.body ?? {};
  const secret = secretProblem(b);
  if (secret) return send(res, secret);

  let network = existing.network as WalletNetwork;
  if (b.network !== undefined) {
    const parsed = parseWalletNetwork(b.network);
    if (!parsed) return send(res, networkProblem());
    network = parsed;
  }

  let name = existing.name as string;
  if (b.name !== undefined) {
    const n = parseName(b.name, network);
    if (isProblem(n)) return send(res, n);
    name = n.name;
  }

  let address = existing.address as string;
  if (b.address !== undefined || network !== existing.network) {
    // Re-validate against the (possibly new) network.
    const addr = parseAddress(network, b.address ?? existing.address);
    if (isProblem(addr)) return send(res, addr);
    address = addr.address;
    if (isDuplicate(db, uid(req), network, address, id)) {
      return send(res, { status: 409, error: 'You have already added this wallet', code: 'DUPLICATE_WALLET' });
    }
  }

  const now = new Date().toISOString();
  if (address !== existing.address || network !== existing.network) {
    // A different address means previous sync results no longer apply.
    run(
      db,
      `UPDATE wallets SET name=?, network=?, address=?, status='connected', status_message=NULL,
         last_synced=NULL, updated_at=? WHERE id=? AND user_id=?`,
      [name, network, address, now, id, uid(req)],
    );
  } else {
    run(db, `UPDATE wallets SET name=?, updated_at=? WHERE id=? AND user_id=?`, [name, now, id, uid(req)]);
  }
  const row = queryOne(db, 'SELECT * FROM wallets WHERE id=? AND user_id=?', [id, uid(req)])!;
  res.json(mapWallet(row));
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const existing = queryOne(db, 'SELECT id FROM wallets WHERE id=? AND user_id=?', [id, uid(req)]);
  if (!existing) {
    res.status(404).json({ error: 'Wallet not found' });
    return;
  }
  run(db, 'DELETE FROM wallets WHERE id=? AND user_id=?', [id, uid(req)]);
  res.json({ ok: true, id });
});

export default router;
