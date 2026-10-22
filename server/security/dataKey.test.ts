/**
 * Per-user data keys (KAN-109): wrap/unwrap with Argon2id, field and upload encryption, and
 * the in-memory session key store.
 * Run: npm run test:isolation
 */
import {
  decryptBytes,
  decryptField,
  encryptBytes,
  encryptField,
  generateDataKey,
  isEncryptedField,
  sessionKeyStore,
  unwrapDataKey,
  wrapDataKey,
} from './dataKey.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const key = generateDataKey();
assert(key.length === 32, 'data key is 256 bits');
assert(!generateDataKey().equals(key), 'data keys are random');

// Wrap and unwrap.
const wrapped = await wrapDataKey(key, 'correct horse 1', 'u1:password');
assert(wrapped.startsWith('dk1:argon2id:19456,2,1:'), 'wrapped key records its KDF parameters');
assert(!wrapped.includes(key.toString('base64url')) && !wrapped.includes(key.toString('hex')), 'wrapped key does not contain the key');
const opened = await unwrapDataKey(wrapped, 'correct horse 1', 'u1:password');
assert(opened?.equals(key), 'right secret unwraps the key');
assert((await unwrapDataKey(wrapped, 'correct horse 2', 'u1:password')) === null, 'wrong secret fails');
assert((await unwrapDataKey(wrapped, 'correct horse 1', 'u2:password')) === null, 'wrap copied to another user fails');
assert((await unwrapDataKey(wrapped, 'correct horse 1', 'u1:recovery')) === null, 'wrap used for another purpose fails');
assert((await unwrapDataKey(wrapped, '', 'u1:password')) === null, 'empty secret fails');
assert((await wrapDataKey(key, 'correct horse 1', 'u1:password')) !== wrapped, 'each wrap uses a fresh salt and IV');

// The same key can sit under several secrets (password, recovery code), and rewrapping keeps it.
const recovery = await wrapDataKey(key, 'ABCD-EFGH-JKLM-NPQR', 'u1:recovery');
assert((await unwrapDataKey(recovery, 'ABCD-EFGH-JKLM-NPQR', 'u1:recovery'))?.equals(key), 'recovery wrap opens the same key');
const rewrapped = await wrapDataKey((await unwrapDataKey(wrapped, 'correct horse 1', 'u1:password'))!, 'new password 9', 'u1:password');
assert((await unwrapDataKey(rewrapped, 'new password 9', 'u1:password'))?.equals(key), 'password change rewraps the same key');
assert((await unwrapDataKey(rewrapped, 'correct horse 1', 'u1:password')) === null, 'old password no longer opens the new wrap');

// Unicode passwords normalise, so the same password typed differently still opens.
const nfc = await wrapDataKey(key, 'café pass 1', 'u1:password');
assert((await unwrapDataKey(nfc, 'café pass 1', 'u1:password'))?.equals(key), 'NFC and NFD passwords match');

// Stored parameters are honoured, so the defaults can be raised later.
const light = await wrapDataKey(key, 'pw 1', 'u1:password', { memory: 8192, passes: 1, parallelism: 1 });
assert(light.includes(':8192,1,1:'), 'custom parameters are stored');
assert((await unwrapDataKey(light, 'pw 1', 'u1:password'))?.equals(key), 'custom parameters unwrap');

// Malformed or tampered wraps fail closed.
const parts = wrapped.split(':');
const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
for (const [i, label] of [[3, 'salt'], [4, 'iv'], [5, 'tag'], [6, 'ciphertext']] as const) {
  const bad = [...parts];
  bad[i] = flip(bad[i]);
  assert((await unwrapDataKey(bad.join(':'), 'correct horse 1', 'u1:password')) === null, `tampered ${label} fails`);
}
for (const bad of ['', 'nope', 'dk1:argon2id:0,2,1:a:b:c:d', 'dk0' + wrapped.slice(3), wrapped.replace('argon2id', 'argon2i')]) {
  assert((await unwrapDataKey(bad, 'correct horse 1', 'u1:password')) === null, `malformed wrap fails: ${bad.slice(0, 20)}`);
}
let threw = false;
try {
  await wrapDataKey(Buffer.alloc(16), 'pw', 'ctx');
} catch {
  threw = true;
}
assert(threw, 'a short data key is rejected');

// Fields.
const field = encryptField(key, '1234.56', 'u1:transactions.amount');
assert(isEncryptedField(field) && !field.includes('1234'), 'field is encrypted');
assert(!isEncryptedField('1234.56') && !isEncryptedField(null), 'plain values are not encrypted fields');
assert(decryptField(key, field, 'u1:transactions.amount') === '1234.56', 'field round-trips');
assert(decryptField(key, encryptField(key, '', 'a'), 'a') === '', 'empty string round-trips');
assert(decryptField(key, encryptField(key, 'Kāpiti 🥝', 'a'), 'a') === 'Kāpiti 🥝', 'unicode round-trips');
assert(encryptField(key, '1234.56', 'u1:transactions.amount') !== field, 'same value encrypts differently each time');
assert(decryptField(generateDataKey(), field, 'u1:transactions.amount') === null, "another user's key can't read it");
assert(decryptField(key, field, 'u2:transactions.amount') === null, 'field moved to another user fails');
assert(decryptField(key, field, 'u1:transactions.notes') === null, 'field moved to another column fails');
assert(decryptField(key, '1234.56', 'u1:transactions.amount') === null, 'plaintext is not decrypted');
assert(decryptField(key, field.slice(0, -2), 'u1:transactions.amount') === null, 'truncated field fails');

// Uploads.
const pdf = Buffer.from('%PDF-1.7 payslip for Aroha');
const sealedPdf = encryptBytes(key, pdf, 'u1:upload:payslips/p1.pdf');
assert(!sealedPdf.includes(Buffer.from('Aroha')), 'upload bytes are encrypted');
assert(decryptBytes(key, sealedPdf, 'u1:upload:payslips/p1.pdf')?.equals(pdf), 'upload round-trips');
assert(decryptBytes(key, sealedPdf, 'u1:upload:payslips/p2.pdf') === null, 'upload swapped to another path fails');
const tampered = Buffer.from(sealedPdf);
tampered[tampered.length - 1] ^= 1;
assert(decryptBytes(key, tampered, 'u1:upload:payslips/p1.pdf') === null, 'tampered upload fails');
assert(decryptBytes(key, Buffer.alloc(10), 'x') === null, 'short upload fails');

// Session key store.
const k2 = generateDataKey();
sessionKeyStore.set('s1', 'u1', key);
sessionKeyStore.set('s2', 'u1', key);
sessionKeyStore.set('s3', 'u2', k2);
assert(sessionKeyStore.get('s1', 'u1')?.equals(key), 'session gets its key');
assert(sessionKeyStore.get('s1', 'u2') === null, "another user can't take a session's key");
assert(sessionKeyStore.forUser('u2')?.equals(k2), 'jobs find a signed-in user key');
const held = sessionKeyStore.get('s1', 'u1')!;
sessionKeyStore.clear('s1');
assert(sessionKeyStore.get('s1', 'u1') === null && held.every((b) => b === 0), 'sign-out drops and zeroes the key');
assert(key.some((b) => b !== 0), "the caller's buffer is copied, not zeroed");
sessionKeyStore.retain(new Set(['s3']));
assert(sessionKeyStore.get('s2', 'u1') === null && sessionKeyStore.forUser('u1') === null, 'expired sessions are dropped');
sessionKeyStore.clearUser('u2');
assert(sessionKeyStore.size() === 0, 'clearing a user drops all their keys');

console.log('OK: data key wrap/unwrap, field and upload encryption, session key store');
