/**
 * Encrypted uploads (KAN-113): with DATA_ENCRYPTION=1 a personal upload is stored sealed and served
 * back in plain to its owner; a locked session gets 423 and another user 404; old plain files are
 * sealed at the owner's next sign-in; business files stay plain; with the flag off nothing is sealed.
 * Run: npm run test:isolation
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-uploads-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';
process.env.DATA_ENCRYPTION = '1';

const { getDb, run } = await import('../db/index.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { uploadsGate, UPLOADS_DIR, isSealedUpload, saveBusinessLogo } = await import('../lib/uploads.ts');
const { runWithCryptoContext } = await import('./fieldCrypto.ts');
const { sessionKeyStore } = await import('./dataKey.ts');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/auth', authRouter);
app.use('/api/uploads', uploadsGate());
const server: Server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const cookieOf = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0];
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');
const onDisk = (rel: string) => fs.readFileSync(path.join(UPLOADS_DIR, rel));
const relOf = (url: string) => url.replace(/^\/?api\/uploads\//, '').replace(/^\/+/, '');

try {
  const db = await getDb();
  const PW = 'correct horse battery 9';
  const register = async (email: string) => {
    const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PW, firstName: 'Up', lastName: 'Load' }) });
    return { cookie: cookieOf(r), uid: String(((await r.json()) as { user: { id: string } }).user.id) };
  };
  const a = await register('owner@example.com');
  const b = await register('other@example.com');

  // A new personal upload is sealed on disk and served back in plain to its owner.
  const up = await fetch(`${base}/api/auth/avatar`, { method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ photoBase64: `data:image/png;base64,${PNG_B64}` }) });
  eq(up.status, 200, 'avatar uploaded');
  const stored = String(((await up.json()) as { user?: { avatarUrl?: string }; avatarUrl?: string }).user?.avatarUrl ?? '');
  const rel = relOf(String(db.exec(`SELECT avatar_url FROM users WHERE id = '${a.uid}'`)[0].values[0][0]));
  eq(rel.startsWith('avatars/'), true, `stored under avatars/ (${stored})`);
  eq([isSealedUpload(onDisk(rel)), onDisk(rel).includes(PNG.subarray(1, 4))], [true, false], 'sealed on disk, no PNG header in clear');
  const got = await fetch(`${base}/api/uploads/${rel}`, { headers: { Cookie: a.cookie } });
  eq([got.status, got.headers.get('content-type')?.startsWith('image/png'), Buffer.from(await got.arrayBuffer()).equals(PNG)], [200, true, true], 'owner gets the original bytes as image/png');

  // Locked session: 423. Another user: 404, as for any file they don't own.
  const locked = await createSession(a.uid);
  const lockedGet = await fetch(`${base}/api/uploads/${rel}`, { headers: { Cookie: `${SESSION_COOKIE}=${locked.rawToken}` } });
  eq([lockedGet.status, ((await lockedGet.json()) as { code: string }).code], [423, 'DATA_LOCKED'], 'locked session gets 423');
  eq((await fetch(`${base}/api/uploads/${rel}`, { headers: { Cookie: b.cookie } })).status, 404, "another user can't fetch it");

  // The seal is tied to the user and path: copied to another user's avatar path, it won't open.
  const bRel = `avatars/${b.uid}.png`;
  fs.copyFileSync(path.join(UPLOADS_DIR, rel), path.join(UPLOADS_DIR, bRel));
  run(db, `UPDATE users SET avatar_url = ? WHERE id = ?`, [bRel, b.uid]);
  eq((await fetch(`${base}/api/uploads/${bRel}`, { headers: { Cookie: b.cookie } })).status, 423, "a sealed file moved to another user doesn't open");

  // An old plain file is sealed at the owner's next sign-in.
  fs.writeFileSync(path.join(UPLOADS_DIR, bRel), PNG);
  eq(isSealedUpload(onDisk(bRel)), false, 'plain legacy file');
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'other@example.com', password: PW }) });
  eq(login.status, 200, 'signed in');
  eq(isSealedUpload(onDisk(bRel)), true, 'sealed at sign-in');
  const bGot = await fetch(`${base}/api/uploads/${bRel}`, { headers: { Cookie: cookieOf(login) } });
  eq(Buffer.from(await bGot.arrayBuffer()).equals(PNG), true, 'and still opens for its owner');

  // Business files stay plain (members read them with their own session).
  const logoRel = runWithCryptoContext({ userId: a.uid, key: sessionKeyStore.forUser(a.uid) }, () => saveBusinessLogo('biz_x', `data:image/png;base64,${PNG_B64}`));
  eq(isSealedUpload(onDisk(logoRel)), false, 'business logo stays plain');

  // Flag off: new uploads are plain, sealed ones still open.
  process.env.DATA_ENCRYPTION = '0';
  const up2 = await fetch(`${base}/api/auth/avatar`, { method: 'POST', headers: { Cookie: b.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ photoBase64: `data:image/png;base64,${PNG_B64}` }) });
  eq(up2.status, 200, 'upload with the flag off');
  const rel2 = relOf(String(db.exec(`SELECT avatar_url FROM users WHERE id = '${b.uid}'`)[0].values[0][0]));
  eq(isSealedUpload(onDisk(rel2)), false, 'flag off: stored plain');
  eq((await fetch(`${base}/api/uploads/${rel}`, { headers: { Cookie: a.cookie } })).status, 200, 'flag off: sealed files still open');
  console.log('upload encryption tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
