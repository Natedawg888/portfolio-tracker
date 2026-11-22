/**
 * Add Wallet client-side secret check (KAN-48). Run: npm run test:wallets
 */
import { KEY_MSG, SEED_MSG, obviousWalletSecret } from './walletSecretHint.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

// Public addresses pass.
for (const a of ['0x52908400098527886E0F7030069857D2E4169EE7', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'So11111111111111111111111111111111111111112']) {
  eq(obviousWalletSecret(a), null, `address passes: ${a.slice(0, 8)}`);
}
eq(obviousWalletSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'), SEED_MSG, '12-word phrase');
eq(obviousWalletSecret('0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'), KEY_MSG, 'hex key');
eq(obviousWalletSecret('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'), KEY_MSG, 'xprv');
eq(obviousWalletSecret('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'), KEY_MSG, 'WIF (uncompressed)');
eq(obviousWalletSecret('KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617'), KEY_MSG, 'WIF (compressed)');
eq(obviousWalletSecret(`[${Array.from({ length: 64 }, (_, i) => i).join(',')}]`), KEY_MSG, 'Solana id.json byte array');
eq(obviousWalletSecret('4'.repeat(88)), KEY_MSG, 'Solana base58 secret length');
eq(obviousWalletSecret(''), null, 'blank');
eq(obviousWalletSecret('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs'), null, 'zpub is public: allowed (KAN-68)');

console.log('walletSecretHint.test.ts ok');
