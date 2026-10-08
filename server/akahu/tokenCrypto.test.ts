/**
 * Akahu access tokens at rest: encrypt on write, open legacy plaintext, migrate when a key is set.
 * Run: npm run test:isolation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isSealedAccessToken,
  openAccessToken,
  sealAccessToken,
} from './tokenCrypto.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  key: process.env.AKAHU_TOKEN_ENCRYPTION_KEY,
};

function restoreEnv() {
  if (savedEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedEnv.nodeEnv;
  if (savedEnv.key === undefined) delete process.env.AKAHU_TOKEN_ENCRYPTION_KEY;
  else process.env.AKAHU_TOKEN_ENCRYPTION_KEY = savedEnv.key;
}

const keyA = crypto.randomBytes(32).toString('base64');
const keyB = crypto.randomBytes(32).toString('hex');
const plain = 'user_token_test_value_not_a_real_secret';

try {
  delete process.env.AKAHU_TOKEN_ENCRYPTION_KEY;
  process.env.NODE_ENV = 'test';
  assert(sealAccessToken(plain) === plain, 'without a key, non-production writes stay plaintext');
  assert(openAccessToken(plain) === plain, 'legacy plaintext still opens');

  process.env.NODE_ENV = 'production';
  let prodMsg = '';
  try {
    sealAccessToken(plain);
  } catch (err) {
    prodMsg = err instanceof Error ? err.message : String(err);
  }
  assert(prodMsg.length > 0, 'production write without a key must fail');
  assert(!prodMsg.includes(plain), 'production error must not include the token');

  process.env.NODE_ENV = 'test';
  process.env.AKAHU_TOKEN_ENCRYPTION_KEY = keyA;
  const sealed = sealAccessToken(plain);
  assert(sealed !== plain, 'sealed token must differ from plaintext');
  assert(isSealedAccessToken(sealed), 'sealed token uses the ptenc1 prefix');
  assert(!sealed.includes(plain), 'ciphertext must not contain the plaintext token');
  assert(openAccessToken(sealed) === plain, 'round-trip decrypts to the original token');

  process.env.AKAHU_TOKEN_ENCRYPTION_KEY = keyB;
  let wrongMsg = '';
  try {
    openAccessToken(sealed);
  } catch (err) {
    wrongMsg = err instanceof Error ? err.message : String(err);
  }
  assert(wrongMsg.length > 0, 'wrong key must not return a token');
  assert(!wrongMsg.includes(plain) && !wrongMsg.includes(sealed), 'decrypt error must not echo token material');

  process.env.AKAHU_TOKEN_ENCRYPTION_KEY = keyA;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-akahu-tok-'));
  process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
  const { getDb, queryOne, run } = await import('../db/index.ts');
  const { getConnectionForUser, upsertConnection } = await import('./connections.ts');
  const db = await getDb();
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`,
    ['user_tok', 'tok@example.test', 'x', now, now],
  );
  run(
    db,
    `INSERT INTO akahu_connections
       (id, user_id, access_token, scope, institutions_json, connected_at, updated_at, last_sync_at)
     VALUES (?,?,?,?,?,?,?,NULL)`,
    ['akahu_legacy', 'user_tok', plain, 'ENDURING_CONSENT', null, now, now],
  );

  const opened = await getConnectionForUser('user_tok');
  assert(opened?.accessToken === plain, 'legacy row opens to the original token');
  const stored = queryOne<{ access_token: string }>(
    db,
    `SELECT access_token FROM akahu_connections WHERE user_id = ?`,
    ['user_tok'],
  );
  const atRest = String(stored?.access_token ?? '');
  assert(isSealedAccessToken(atRest), 'legacy plaintext is encrypted on read when the key is set');
  assert(!atRest.includes(plain), 'database no longer holds the plaintext token');

  const again = await getConnectionForUser('user_tok');
  assert(again?.accessToken === plain, 'encrypted row still opens');

  await upsertConnection({
    userId: 'user_tok',
    accessToken: `${plain}_rotated`,
    scope: 'ENDURING_CONSENT',
  });
  const afterWrite = queryOne<{ access_token: string }>(
    db,
    `SELECT access_token FROM akahu_connections WHERE user_id = ?`,
    ['user_tok'],
  );
  const written = String(afterWrite?.access_token ?? '');
  assert(isSealedAccessToken(written), 'upsert stores ciphertext');
  assert(written !== `${plain}_rotated`, 'upsert does not store the new token in plaintext');
  const rotated = await getConnectionForUser('user_tok');
  assert(rotated?.accessToken === `${plain}_rotated`, 'upsert round-trips through encryption');
  assert(rotated?.scope === 'ENDURING_CONSENT', 'scope is unchanged and is not a payments scope');

  console.log('OK: akahu token encryption');
} finally {
  restoreEnv();
}
