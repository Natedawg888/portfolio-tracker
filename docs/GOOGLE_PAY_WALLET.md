# Google Pay / Google Wallet — personal spending history

Research date: **2026-10-01**.  
Goal: observe personal spend for the NZ portfolio tracker. Prefer official export/API; no scraping of signed-in sessions.

Cross-links: [KIWIBANK_PLAN.md](./KIWIBANK_PLAN.md) · [IMPORT_FORMATS.md](./IMPORT_FORMATS.md)

---

## Conclusion (short)

**There is no public Google API for a third-party app to pull a consumer’s Google Pay / Google Wallet transaction history.** Official options are: view in-app / on Wallet web (eligible markets), **Google Takeout** JSON export, and — most reliable for NZ net-worth/spend tracking — **the funding bank/card statement** (e.g. Kiwibank via Akahu or CSV). For v1, implement a **manual CSV/JSON import UX** fed by Takeout conversion or bank CSV; do not invent a Google Pay sync.

---

## Official personal export / Takeout / API

### View (not export API)

- Google Help: [Find, export, or delete Google Pay & Google Wallet info](https://support.google.com/googlepay/answer/9015738?hl=en)
- In Wallet app or [Google Wallet website](https://wallet.google/) (help notes **eligible markets only** for some web features).  
- Wallet web transactions help: [View transactions on the Google Wallet website](https://support.google.com/wallet/answer/13623624?hl=en-AU) — contactless, device payments, online virtual card; **Plaid-linked accounts US only**. Explicitly: some details require the **bank statement**.

### Export

1. Go to [takeout.google.com](https://takeout.google.com).  
2. Enable **Google Pay** and/or **Google Wallet** products.  
3. Create export (ZIP; typically JSON activity, not a ready-made bank CSV).  
4. Convert JSON → CSV offline (Excel Power Query or a local script).  
   Third-party walkthrough (non-Google): [bankxlsx.com blog](https://bankxlsx.com/blog/can-i-export-google-pay-google-wallet-transactions-to-csv-or-excel) — fields often cited after expand: `transactionTime`, `amount`, `currency`, merchant/counterparty, `paymentInstrument` (last4), `status`. **Treat field names as provisional until a real Takeout sample is inspected.**

### APIs

- **Google Pay API** (merchant / checkout) is for accepting payments — **not** for listing personal history. Community consensus (e.g. Stack Overflow, Reddit data-engineering): no personal transaction-history API.  
- **Google Pay Business Settlement Reports** (merchant) ≠ end-user purchase ledger.  
- **Do not use** unofficial session scraping or password capture.

---

## NZ realism

- Kiwibank supports Google Pay for Visa Debit/credit; history tip: *“see your Google Pay transaction history in the Google Wallet app”*.  
  Source: [Kiwibank — Help with Google Pay](https://www.kiwibank.co.nz/help/payments/mobile-wallets/help-with-google-pay/)
- NZ banks (BNZ, ASB, etc.) similarly point users to Wallet **and** bank statements for complete detail.
- Wallet web eligibility for NZ can vary; **bank CSV / Akahu on the card’s issuer account is the durable source of truth** for portfolio spend categorisation.
- Google Pay / Wallet tap history is often a **subset** of card activity (and Play/YouTube purchases may live under payments.google.com / My Activity instead).

---

## Recommended v1 UX (fallback)

1. Prefer **Kiwibank (or issuer) transaction import/sync** — Google Pay spends appear as card/EFTPOS lines there.  
2. Optional secondary path: **Takeout → JSON → local converter → CSV import** into the tracker.  
3. UI: “Import wallet/spend CSV” with column mapping preview; store `externalId` for dedupe.  
4. Stub: `src/imports/googlePayTakeout.ts`, `src/imports/walletCsv.ts`.

### What’s blocked

| Capability | Status |
| --- | --- |
| Live third-party Google Pay txn API | **Unavailable** (no official consumer history API found) |
| OAuth “Connect Google Pay” sync | **Blocked** — no sanctioned personal history endpoint to call |
| Takeout-based import | Needs Nathan to run Takeout and provide the file |
| Bank-backed spend history | Unblocked once Kiwibank/Akahu or CSV path works |

---

## Security

- Never ask for Google password.  
- Takeout is user-initiated download; process files locally.  
- Do not scrape wallet.google.com while logged in via automation for this product.
