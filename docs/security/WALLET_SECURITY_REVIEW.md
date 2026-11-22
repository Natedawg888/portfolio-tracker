# Wallet feature security review (KAN-48)

Reviewed 23 November 2026 on `alpha` (after #205). Scope: crypto wallets (KAN-33 to KAN-45, KAN-69), the chain adapters in `server/chain/`, the Pro crypto ledger (`server/crypto/`), and the Add Wallet screen. Solana (KAN-38, PR #219) was checked against the same points.

## Result

No blockers. Three small gaps fixed in this PR (below). The crypto feature can launch on these points.

## 1. No seed phrase, private key or password is stored

| Check | Where | Result |
|---|---|---|
| The `wallets` table holds only name, network, public address, sync status and timestamps | `server/db/schema.sql` (`wallets`) | ✅ No key, phrase or password column |
| Addresses are validated per network, and secrets are refused before validation | `server/lib/walletAddress.ts` `validateWalletAddress` → `detectSecret` | ✅ BIP39 phrases, 32-byte hex keys, xprv-family, WIF, Solana keypairs (base58 and JSON byte array, checked as a real Ed25519 pair) |
| The wallet **name** is screened too | `server/routes/wallets.ts` (`detectSecret(v, 'name')`) | ✅ |
| Refusals don't echo the input back | `SECRET_MESSAGES` are fixed strings | ✅ |
| Add Wallet stops obvious secrets in the browser so they're never sent | `src/components/AddWalletPanel.tsx` | ⚠️ → ✅ **Fixed:** the client check missed WIF keys and Solana keypairs (the server still refused them, but they were sent). It now lives in `src/lib/walletSecretHint.ts` with tests and covers the same key forms |
| Free text on the Pro crypto ledger (notes, counterparty, DeFi protocol/assets/notes) | `server/crypto/store.ts` | ⚠️ → ✅ **Fixed:** these took any text, so a pasted phrase or key would have been stored. They're now screened with `detectSecret` and refused with a clear message |
| xpub watching (KAN-68, not built yet) | n/a | The ticket keeps xprv-family rejected and forbids logging the xpub. Check again when it lands |

## 2. Logs contain addresses only, never secrets

| Check | Where | Result |
|---|---|---|
| HTTP request log | `server/index.ts` | ✅ Method, path, status, time and IP only; no bodies, cookies or query strings |
| Wallet sync log | `server/chain/sync.ts` | ✅ Wallet id, network, code and timings. Unexpected errors go through `redactChainSecrets` and are cut to 200 characters |
| Stored sync error (`wallets.status_message`) | `server/chain/sync.ts` | ✅ Redacted before it's saved |
| Adapter warnings | `server/chain/evm.ts` | ⚠️ → ✅ **Fixed:** two `console.warn` lines printed the raw error message. Provider errors are already safe, but an unexpected error could in principle carry an env URL with a key in it. They now go through `redactChainSecrets` too. (`solana.ts` in #219 logs the address and a provider error message only) |
| A rejected secret is never logged | The route returns 400 before anything is logged; request bodies aren't logged | ✅ |

## 3. Provider RPC / API keys are server-side only

| Check | Where | Result |
|---|---|---|
| Keys come from `CHAIN_<NETWORK>_RPC_URL / _API_KEY / _INDEXER_URL`, read on the server | `server/chain/config.ts` | ✅ |
| Not in the browser bundle | Vite only exposes `VITE_*` variables; `vite.config.ts` has no `define` | ✅ |
| What the client can see about config | `describeChainConfig()` → booleans and env var **names** only | ✅ |
| Errors shown to users | `ChainProviderError` messages are written without URLs. `redactChainSecrets` strips full URLs, keys and long path/query tokens | ✅ (tested in `chain.test.ts`) |

## 4. Other checks

- **Isolation:** every wallet route is behind the session and scoped to `user_id`; another user's wallet gives 404 (`sync.test.ts`, `verify-user-isolation`). ✅
- **Custodial and exchange addresses** are refused (KAN-69, `custodialDenylist.ts`). ✅
- **Rate limiting:** manual sync has a cooldown (429 with `Retry-After`), and provider rate limits back off per network. ✅
- **Outbound requests** only go to configured https endpoints (plain http only to loopback). ✅

## Recommendations (not blockers)

1. Use keyed RPC endpoints on Railway for Ethereum and Solana. The public ones are rate-limited, which shows up as sync errors rather than as a security problem.
2. When KAN-106 (per-user encryption) lands, add `wallets.address` and the crypto ledger to the encrypted columns. Addresses are public on-chain, but linking one to a person is still personal data.
