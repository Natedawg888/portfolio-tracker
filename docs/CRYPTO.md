# Advanced crypto (KAN-47, Pro)

Portfolio → **Crypto gains, staking income and DeFi** (`/crypto`). Pro plan only (`crypto_pro` in `server/lib/entitlements.ts`); everyone else gets `402 PRO_REQUIRED` and a description of what Pro adds.

## Ledger and gains (`src/lib/cryptoGains.ts`)

A ledger of crypto transactions, each with the NZD value at the time (never guessed; rows without a needed value are flagged and left out of the money figures).

| Kind | Effect |
| --- | --- |
| Buy, staking reward, airdrop, paid in crypto | Acquire at the NZD value (buys add their fee) |
| Sell, spend, gift sent, network fee | Dispose: proceeds = NZD value (less fees on sells and spends) |
| Swap | Dispose of what was given at its NZD value; acquire what was received at the same value |
| Transfer in / out (own wallets), DeFi deposit / withdrawal | No change: still yours |

- **Cost basis:** first-in first-out (default) or weighted average cost, per user. These are the two methods IRD lists ([Calculating cryptoasset income](https://www.ird.govt.nz/cryptoassets/taxing/income-expenses/calculating-cryptoasset-income)). Income = sale price − purchase cost − transaction fees. Crypto received as payment costs its value when received. Unrealised gains aren't taxable.
- **Realised gains and income** are reported for each NZ tax year (1 April – 31 March).
- **Unrealised gains** use today's crypto quotes. They're left blank for any coin whose cost isn't fully known.
- **Flags:** selling more than the ledger shows you held is flagged; the missing units cost 0.

## NZD values (`server/crypto/prices.ts`)

IRD ([Convert cryptoasset values to NZD](https://www.ird.govt.nz/cryptoassets/taxing/income-expenses/convert-currency)) names Yahoo Finance's cryptocurrency section as a source and asks for a consistent method.

- **The price:** Yahoo Finance daily close for `<ASSET>-USD` on the day, or the nearest earlier day within 3, × the Frankfurter (ECB) USD→NZD rate, or the nearest earlier working day within 7.
- **Equivalents:** wrapped tokens are priced as their underlying (WETH → ETH, WBTC → BTC).
- **No price, no guess:** if no price is found, nothing is filled in.

## Wallet import

- **What's read:** native transactions (EVM and Bitcoin adapters) and ERC-20 token transfers (Blockscout `token-transfers`, EVM with an indexer; scam-flagged tokens are dropped) for a synced wallet. Gas the wallet paid becomes a network-fee row.
- **Suggested kinds:**
  - to / from another of your wallets → transfer
  - sent and received in one transaction → swap (the two legs are shown and saved as one)
  - three or more incoming amounts of one coin from one sender who is never paid → staking reward (a guess)
  - otherwise buy / sell (guesses)
- **Saving:** nothing is saved until the user presses Save. Imported and ignored transfers are remembered (`crypto_import_refs`) and not offered again. Tokens with unusual names start as ignored, and bulk "ignore" buttons help with airdrop spam. Up to 30 price lookups happen per preview.

## DeFi positions

Lending, liquidity, staking, vault or borrowing positions at the value the user records (not read from the chain). Positions set to count go into net worth as `defiNzd` / `byClass.defi`, with borrowing as a minus.

## Data

Tables: `crypto_txns`, `crypto_import_refs`, `crypto_settings`, `defi_positions`. All are scoped to the user and deleted with the account. Tests: `npm run test:crypto`.
