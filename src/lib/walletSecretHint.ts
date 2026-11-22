/**
 * Client-side check on what someone pastes into Add Wallet (KAN-48): catch private keys and
 * recovery phrases before they leave the browser. The server checks again with the full rules
 * (server/lib/walletAddress.ts detectSecret) and never stores or logs what it rejects; this only
 * stops the obvious cases from being sent at all.
 */
export const SEED_MSG = 'That looks like a recovery phrase. Never share it with anyone — only your public wallet address is needed.';
export const KEY_MSG = 'That looks like a private key. Never share it with anyone — only your public wallet address is needed.';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function obviousWalletSecret(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // 12+ words: a recovery phrase (addresses are a single token).
  if (s.split(/[\s,;]+/).filter((w) => /^\p{L}{3,8}$/u.test(w)).length >= 12) return SEED_MSG;
  const compact = s.replace(/\s+/g, '');
  // Raw 32-byte hex key (EVM and others).
  if (/^(0x)?[0-9a-f]{64}$/i.test(compact)) return KEY_MSG;
  // BIP32 extended private keys (xprv, yprv, zprv, tprv and multisig forms).
  if (/^[xyztuvYZUV]prv/.test(compact)) return KEY_MSG;
  // Bitcoin WIF private key: base58, 51–52 characters starting 5, K, L (mainnet) or 9, c (testnet).
  if (/^[5KL9c]/.test(compact) && (compact.length === 51 || compact.length === 52) && BASE58.test(compact)) return KEY_MSG;
  // Solana keypair exported as a JSON byte array (id.json).
  if (/^\[[\d,]+\]$/.test(compact) && compact.slice(1, -1).split(',').filter(Boolean).length >= 32) return KEY_MSG;
  // Solana secret key in base58 (64 bytes ≈ 87–88 characters); addresses are 32–44.
  if (compact.length >= 80 && BASE58.test(compact)) return KEY_MSG;
  return null;
}
