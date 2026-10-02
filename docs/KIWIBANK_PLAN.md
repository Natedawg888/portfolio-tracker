# Kiwibank open banking plan (v1)

Research date: **2026-10-01** (Pacific/Auckland).  
Goal: read-only balances + transactions for Nathan’s Kiwibank accounts in the portfolio tracker. Prefer sanctioned OAuth; never collect bank passwords.

---

## Executive recommendation

**Use Akahu (personal app → enduring read-only account info) for v1.** Akahu is an accredited requestor in NZ’s regulated open banking system and already connects to Kiwibank via official open banking for accounts and transactions. Direct third-party integration against Kiwibank’s own developer APIs is possible in principle (Payments NZ Account Information standards; Kiwibank reports Account Information v3.0 READY), but requires Third Party accreditation / bilateral onboarding — disproportionate for a personal portfolio tracker. Keep **CSV/OFX/QIF export** as an offline fallback.

Cross-links: [IMPORT_FORMATS.md](./IMPORT_FORMATS.md) · [GOOGLE_PAY_WALLET.md](./GOOGLE_PAY_WALLET.md) · [SHARESIES_KIWISAVER.md](./SHARESIES_KIWISAVER.md) · [GOMINING.md](./GOMINING.md)

---

## 1. What Akahu supports for Kiwibank

### Connection model

- Akahu primarily connects to Kiwibank via the **regulated open banking** system (not classic credential scraping for this bank).  
  Source: [Akahu troubleshooting — Kiwibank](https://www.akahu.nz/troubleshooting)
- Prerequisites for the customer: registered for Kiwibank online banking or mobile app.
- **Not connectable via official OB (Akahu notes):** KiwiSaver, managed fund, FX accounts.

### Account types (official OB feature matrix)

| Product | Kiwibank via official OB |
| --- | --- |
| Transactional | ✅ |
| Savings | ✅ |
| Loan | ✅ |
| Credit card | ✅ |
| Term deposit | ✅ |
| Managed fund / KiwiSaver / FX | ❌ |

Source: [Official open banking — account types](https://developers.akahu.nz/me/docs/official-open-banking-feature-support-accounts)  
Kiwibank is noted as supporting **all business accounts** under OB (unlike peers with temporary exemptions).

### Auth model (developer)

- **Enduring account connectivity** (ongoing) or **one-off** account connectivity.
- Full apps: OAuth2 **authorization code** flow → redirect → exchange `code` for long-lived **user access token**.  
  Docs: [Authorising with OAuth2](https://developers.akahu.nz/docs/authorizing-with-oauth2), [Official OB OAuth](https://developers.akahu.nz/docs/official-open-banking-oauth)
- **Personal apps** (best fit for Nathan-only tracker): free, **1 user = your own Akahu account**, ongoing connectivity, **no payments / no webhooks**. Tokens from Developers page after MFA.  
  Docs: [Personal Apps](https://developers.akahu.nz/docs/personal-apps), [Getting Started](https://developers.akahu.nz/me/docs/getting-started)
- API base: `https://api.akahu.io/v1/`
- Typical read endpoints:
  - `GET /accounts` — balances, account numbers, type, attributes  
    [Accessing account data](https://developers.akahu.nz/docs/accessing-account-data)
  - `GET /transactions` — settled txns (UTC timestamps; optional `start`/`end`)  
    [GET /transactions](https://developers.akahu.nz/reference/get_transactions)
- Read-oriented legacy scopes (inline auth): `ENDURING_CONSENT` + `ACCOUNTS` + `TRANSACTIONS` (and optionally identity scopes). Prefer **not** enabling `PAYMENTS`.  
  [Scopes](https://developers.akahu.nz/me/docs/scopes)
- Headers: `Authorization: Bearer <user_access_token>`, `X-Akahu-Id: <app_id_token>`

### Developer signup & pricing (public)

| Path | Pricing (public docs) | Limits |
| --- | --- | --- |
| **Personal app** | Free | Own Akahu user only; daily refresh; 1h manual refresh rest; no payments/webhooks |
| **Full app** | Usage-based (not billed during dev/test; fixed fees may still apply) | Multi-user; accreditation required before production |

- Create personal app at [my.akahu.nz](https://my.akahu.nz) → Developers. Agree to Developer Terms; MFA.  
- Full app: contact `hello@akahu.nz` / Slack; accreditation tiers documented at [App Accreditation](https://developers.akahu.nz/docs/app-accreditation) (first review free; subsequent reviews **NZ$1,000** each).
- TypeScript SDK mentioned in Getting Started.

### Official OB data caveats (all banks, including Kiwibank)

Documented differences vs classic connections: loan detail fields may be missing; joint-account holder names may be incomplete; transaction `date`/`type` may be coarser.  
Source: [Account information feature support](https://developers.akahu.nz/me/docs/official-open-banking-feature-support-data)

---

## 2. Does Kiwibank offer direct consumer Open Banking / CDR-style APIs?

### Consumer product

- Kiwibank consumer Open Banking page: [kiwibank.co.nz/banking-with-us/open-banking](https://www.kiwibank.co.nz/banking-with-us/open-banking/)
- Messaging (fetched 2026-10-01): customers can **make payments** via Open Banking from **May 2026**, and **share data** from **November 2026**. Always login at Kiwibank; never share password with third parties.
- Media release (2025-06-03): partner **Wych** for integration; **no fees** to accredited third parties for standard API requests; commit to payment initiation by **30 May 2026** and account information by **30 November 2026**.  
  [Media release](https://www.kiwibank.co.nz/about-us/news-and-updates/media-releases/kiwibank-to-provide-open-banking/)

### Industry standards / readiness

- Payments NZ API Centre standards: Account Information + Payment Initiation (v2.3 / v3.0.x).  
  [Minimum Open Banking Implementation Plan](https://www.apicentre.paymentsnz.co.nz/standards/implementation/minimum-open-banking-implementation-plan/)  
  [Implementation Reporting](https://www.apicentre.paymentsnz.co.nz/standards/implementation/implementation-reporting/) — as of reporting dated **28 May 2026**, Kiwibank marked **READY** for Payment Initiation **and** Account Information (v3.0, backwards compatible with v2.3).
- **Note the mismatch:** API Centre “READY” vs consumer page “data sharing from November 2026”. Treat consumer availability and Third Party onboarding as **separate** from technical readiness. Do not assume any random app can call Kiwibank AI APIs without accreditation.

### Direct third-party path (not recommended for v1)

- Become a Payments NZ API Centre **Third Party**, complete security/accreditation, and enter a bilateral / provider-mediated agreement with Kiwibank (Wych-assisted).  
- Consumer page links “Explore open banking APIs for developers” but **no standalone public self-serve developer portal URL with published API keys was found** during this research (2026-10-01). Status: **unclear / not self-serve for hobby apps**.
- CDR (Australia) is a different regime; NZ uses Payments NZ / Customer and Product Data standards — not an AU CDR endpoint.

**Conclusion:** Direct Kiwibank AI for this tracker is **blocked** until Nathan (or the app) is an accredited Third Party **and** product/consent UX is live for data sharing. Use **Akahu** as the accredited intermediary instead.

---

## 3. Recommended v1 path

1. **Primary:** Akahu **Personal App** + connect Kiwibank via Akahu OAuth / official OB consent (read-only scopes).  
2. **Server:** store only Akahu **user access token** + app token (secrets out of the browser); never bank passwords.  
3. **Fallback:** manual CSV / OFX / QIF / JSON export from Kiwibank internet banking → parsers under `src/imports/`.  
4. **Defer:** full Akahu app + accreditation unless the tracker becomes multi-user.

Stub modules (scaffold alignment):

- `src/imports/kiwibankCsv.ts`
- `src/imports/kiwibankOfx.ts`
- `src/api/akahuClient.ts` (TODO — personal-app headers)

---

## 4. Exact signup / consent steps Nathan must do

**No passwords in chat. OAuth / bank consent only.**

### A. Akahu Personal App (primary)

1. Create / sign in at [https://my.akahu.nz](https://my.akahu.nz).  
2. Complete identity verification and **MFA** if prompted (required for Developers / personal app).  
3. Open **Developers**, accept **Developer Terms**, create a **personal app**.  
4. Copy **App ID Token** (`X-Akahu-Id`) and **User Access Token** into a local secret store / `.env` (never commit).  
5. In Akahu, **connect Kiwibank** when prompted: complete Kiwibank’s open-banking consent in the Kiwibank app / internet banking redirect (official mark). Select only the accounts needed.  
6. Confirm prerequisites: Kiwibank online banking or mobile app registration ([troubleshooting](https://www.akahu.nz/troubleshooting)).  
7. Smoke-test: `GET https://api.akahu.io/v1/me` then `GET /accounts` and `GET /transactions` with the two headers.  
8. Revoke anytime at my.akahu.nz or in Kiwibank authorisation management ([Kiwibank Open Banking](https://www.kiwibank.co.nz/banking-with-us/open-banking/)).

### B. Full Akahu app (only if multi-user later)

1. Email `hello@akahu.nz` / Slack for a full app.  
2. Configure redirect URI; implement OAuth code exchange **server-side** (App Secret never in frontend).  
3. Complete [accreditation](https://developers.akahu.nz/docs/app-accreditation) before production.

### C. CSV/OFX fallback (no API)

1. Log in to Kiwibank internet banking via [kiwibank.co.nz](https://www.kiwibank.co.nz) (desktop; export is limited/awkward on mobile).  
2. Open the account → transaction history.  
3. **Refreshed UI:** Export icon → choose **CSV / JSON / OFX / QIF / PDF** (exports limited to **two years**; older via Statement vault).  
   Source: [Online banking refresh — export](https://www.kiwibank.co.nz/banking-with-us/online-banking/internet-banking/a-new-internet-banking-experience-is-coming/)  
4. **Classic UI (still documented by accountants):** Search/export options → date range → CSV / QIF / OFX → Export.  
5. Import the file in the portfolio tracker (no credentials leave the bank).

---

## 5. Security notes

- **Never collect or store Kiwibank passwords** in this app.  
- Use **OAuth redirect** / official bank consent only (Akahu hosted flow → Kiwibank → back).  
- Do not embed Akahu OAuth in an iframe; mobile should use system browser / Custom Tabs / ASWebAuthenticationSession ([OB OAuth guide](https://developers.akahu.nz/docs/official-open-banking-oauth)).  
- Keep **App Secret** and user tokens server-side only.  
- Prefer read-only scopes; do not request payment initiation for a net-worth tracker.  
- On token revoke / `401`, clear local tokens and prompt reconnect.

---

## 6. CSV / OFX fallback — formats & mapping

Kiwibank publicly documents export formats: **CSV, JSON, OFX, QIF, PDF** (refreshed internet banking). Third-party guides also mention “Full CSV” and “Comma Separated Values - Basic (CSV)”.

**Observed / reported CSV columns (third-party; confirm against a real export before locking the parser):**

| Likely column | Maps to `Transaction` |
| --- | --- |
| Date (DD/MM/YYYY typical NZ) | `date` (normalize to `YYYY-MM-DD` Auckland) |
| Memo / Description / Particulars | `description` |
| Amount | `amount` (signed; confirm debit/credit sign) |
| Balance | optional running balance (not required on `Transaction`) |
| Code / Reference / Analysis (Full CSV if present) | append into description or `externalId` hash input |

Sources: [Owdyn — NZ bank CSV](https://owdyn.com/blog/how-to-import-nz-bank-transactions), [Owdyn — Kiwibank](https://owdyn.com/banks/kiwibank), [Robertson Bixley — Full CSV](https://www.robbix.co.nz/download-a-csv-from-kiwibank/), [TaxMatterz export guide](https://help.taxmatterz.com/exporting-your-bank-transactions).

**OFX / QIF:** standard bank download formats; prefer OFX for structured `STMTTRN` fields if CSV columns vary across UI versions. See [IMPORT_FORMATS.md](./IMPORT_FORMATS.md).

**Do not invent columns** — ship a header-sniffing mapper and fixture from Nathan’s real export.

---

## 7. What’s blocked until Nathan completes signup/consent

| Capability | Blocked until |
| --- | --- |
| Live Kiwibank balances via API | Akahu personal app created + Kiwibank connected/consented |
| Live transaction sync | Same + successful `GET /transactions` |
| Auto daily refresh | Personal app schedule (daily) or full-app webhooks after accreditation |
| Direct Kiwibank Third Party API | Accreditation + provider onboarding; consumer data-sharing product live for Nathan’s use case |
| KiwiSaver / managed fund / FX via Akahu↔Kiwibank OB | **Unavailable** per Akahu OB matrix — use other providers’ exports (e.g. Sharesies docs) |
| CSV import path | Nathan downloads an export file (no API consent needed) |

---

## Stub module paths

```
src/api/akahuClient.ts          # TODO: personal-app GET /accounts, /transactions
src/imports/kiwibankCsv.ts      # TODO: sniff headers → Transaction[]
src/imports/kiwibankOfx.ts      # TODO: OFX STMTTRN → Transaction[]
src/imports/types.ts            # shared ImportResult / column map
```

