/**
 * Akahu connect login_hint. A synthetic linked address is omitted.
 * Run: npm run test:akahu
 *
 * Throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-akahu-connect-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');
process.env.AKAHU_APP_ID = 'app_test';
process.env.AKAHU_APP_SECRET = 'secret_test';
process.env.AKAHU_REDIRECT_URI = 'http://127.0.0.1:9/api/akahu/callback';
delete process.env.AKAHU_USER_TOKEN;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: akahuRouter } = await import('./akahu.ts');

const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
const people: [string, string][] = [
  ['real', 'real@example.com'],
  ['syn', 'linked.connect@accounts.koruledger.invalid'],
  ['blank', ''],
];
for (const [id, email] of people) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'h', now, now]);
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/akahu', akahuRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/akahu`;

async function connect(userId: string): Promise<{ status: number; authorizeUrl: string; text: string }> {
  const cookie = `${SESSION_COOKIE}=${(await createSession(userId)).rawToken}`;
  const res = await fetch(`${base}/connect`, { method: 'POST', headers: { Cookie: cookie, Accept: 'application/json' } });
  const text = await res.text();
  const json = JSON.parse(text) as { authorizeUrl?: string };
  return { status: res.status, authorizeUrl: json.authorizeUrl ?? '', text };
}

try {
  const real = await connect('real');
  assert(real.status === 200, `real connect (${real.status} ${real.text})`);
  const realUrl = new URL(real.authorizeUrl);
  assert(realUrl.searchParams.get('login_hint') === 'real@example.com', 'a real address is the login hint');

  const syn = await connect('syn');
  assert(syn.status === 200, `synthetic connect (${syn.status} ${syn.text})`);
  const synUrl = new URL(syn.authorizeUrl);
  assert(!synUrl.searchParams.has('login_hint'), 'a synthetic address is omitted');
  assert(!syn.text.includes('accounts.koruledger.invalid') && !syn.text.includes('.invalid'), 'connect response has no synthetic address');

  const blank = await connect('blank');
  assert(blank.status === 200 && !new URL(blank.authorizeUrl).searchParams.has('login_hint'), 'a blank address is omitted');
  console.log('akahu connect login_hint tests passed');
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
