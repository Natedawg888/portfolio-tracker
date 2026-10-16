# Local auth (email / password)

Portfolio Tracker uses **local accounts** on the machine running the API, with optional **Sign in with Google / Apple / Microsoft** (see below).

## How it works

- **Create account** — email + password (min 8 chars, letter + number).
- **Login / logout** — session stored as an **httpOnly** cookie (`pt_sid`). Raw token never lands in `localStorage`.
- **Passwords** — hashed with Node **scrypt** (`scrypt$N$r$p$salt$hash`). Plaintext is never stored.
- **Sessions** — random token in cookie; **SHA-256 hash** only in `sessions` table (sql.js). TTL ≈ 30 days.
- **API gate** — all `/api/*` routes except `/api/auth/*` and `/api/health` require a valid session.
- **UI gate** — unauthenticated users only see `/login` or `/register`.

## Two-factor sign-in, sessions and devices (KAN-16)

**Turn it on:** Settings → Security → Two-factor sign-in → Turn on. Enter your password, scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator), then type the 6-digit code it shows. You get **10 backup codes** — save them (Copy / Download .txt); they are shown once.

**Signing in with 2FA:** password first, then the 6-digit code (or a backup code). Tick **Trust this device for 30 days** to skip the code on that browser. Untick **Keep me signed in** on the sign-in page for a session that ends when the browser closes (the server also forgets it after 24 h). The sign-in page remembers the last email used on that browser (never the password); **Use a different email** clears it.

**Lost your phone?** On the code step choose **Use a backup code**. Each works once; when 3 or fewer are left, make a new set under Settings → Security (password + a current code). Then turn 2FA off and on again with your new phone.

**Lost the phone *and* the backup codes:** the server operator confirms it's really you, then runs `npm run auth:reset-2fa -- you@example.com`. That turns 2FA off, removes backup codes and trusted devices, and signs the account out everywhere; the password is unchanged.

**Settings → Security** also lists every signed-in session (device, last active, whether it's kept signed in) with **Sign out** / **Sign out all other sessions**, and trusted devices with **Remove**. Changing your password signs out every other session.

**Several accounts on one browser:** profile menu → **Add another account** signs in without leaving the current one; the menu then lists every account signed in here with **Switch**. **Sign out** ends the active account and the next one takes over; **Sign out of all accounts** ends them all. The active session stays in `pt_sid`; the others' session tokens sit in `pt_accts` (httpOnly, scoped to `/api/auth`, up to 4). They're ordinary sessions, listed and revocable in Settings → Security; a revoked one silently drops out of the menu. Signing the same account in again replaces its old session.

How it's stored:

- TOTP secrets: AES-256-GCM sealed in `users.totp_secret_enc` (pending setup in `totp_pending_enc`, 15 min to confirm). Key: `AUTH_ENCRYPTION_KEY` (32 bytes, 64 hex chars — generate with `openssl rand -hex 32`). Without it a key is generated once at `data/secrets/auth.key` (mode 0600); that protects copies of the `.db` on their own but not a copy of the whole `data/` folder, so set the env var in production and keep it out of backups. Losing the key means 2FA users need `auth:reset-2fa`.
- Backup codes (`user_backup_codes`), pending sign-ins (`login_challenges`, 5 min, 5 attempts) and trusted devices (`trusted_devices`, cookie `pt_tdev` scoped to `/api/auth`, httpOnly) store **SHA-256 hashes only**, like sessions.
- A TOTP code is accepted once (`totp_last_step`) and within ±30 s.
- Sign-in attempts are limited per account (10 failures / 15 min) and per client address (50 / 15 min), counting wrong passwords and wrong codes; memory only, reset on restart.
- Sessions record a coarse device label (“Chrome on Windows”) and last-active time (written at most every 10 min) — never the raw User-Agent or IP.

Tests: `npm run test:2fa` (RFC 6238 vectors, sealing, replay, backup codes, trusted devices, sessions, rate limits).

## Sign in with Google, Apple or Microsoft

Each button appears on the sign-in page only when that provider's credentials are set in `.env`. The redirect (callback) URL to register with every provider is

    ${PUBLIC_URL}/api/auth/sso/<google|apple|microsoft>/callback

(`PUBLIC_URL` defaults to `http://127.0.0.1:3000` locally; use your HTTPS domain in production.) Restart the API after changing `.env`.

**Google** — Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → *Web application*. Add the callback URL under *Authorised redirect URIs*. Configure the OAuth consent screen (scopes: `openid`, `email`, `profile`). Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

**Microsoft** — Azure portal → Microsoft Entra ID → App registrations → New registration. *Supported account types*: personal + work/school (or your tenant only). Redirect URI: platform *Web*, the callback URL. Certificates & secrets → New client secret. Token configuration → add optional claims `email` and `xms_edov` to the ID token. Set `MICROSOFT_CLIENT_ID` (Application ID), `MICROSOFT_CLIENT_SECRET` (the secret *value*), and optionally `MICROSOFT_TENANT` (default `common`; a tenant ID pins sign-in to that organisation).

**Apple** — needs a paid Apple Developer account and an HTTPS domain (Apple doesn't allow localhost callbacks). Certificates, Identifiers & Profiles → Identifiers → an App ID with *Sign in with Apple*, then a *Services ID* (this is the client ID) with Sign in with Apple configured for your domain and the callback URL. Keys → create a key with Sign in with Apple → download the `.p8`. Set `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the `.p8` contents; newlines may be written as `\n`).

How it behaves:

- A provider account is remembered by its stable ID (`user_identities.provider + subject`), not by email.
- First sign-in with an email that already has an account **links to it only when the provider says the email is verified** (Google `email_verified`, Apple `email_verified`, Microsoft personal accounts or `xms_edov`). Otherwise: “sign in with your password, then connect it under Settings → Security”.
- A new email creates a new account (no password). It can sign in with the provider, and can set a password under Settings → Security (needed to turn on 2FA, change email or delete the account). The last sign-in method can't be disconnected until a password is set.
- **2FA still applies**: with 2FA on, an untrusted browser goes to the code step after the provider. **Add another account** works with providers too.
- Settings → Security → *Sign-in methods* lists connected providers (Disconnect) and offers **Connect Google / Apple / Microsoft** for the signed-in account.
- Security: `state` + `nonce` + PKCE (Google, Microsoft) in a sealed, httpOnly, 10-minute cookie bound to the browser; ID tokens verified against the provider's published keys (RS256 signature, issuer, audience, expiry, nonce) using Node crypto; client secrets never reach the browser. Apple's form POST is re-issued as a same-site GET so the cookies arrive.

Tests: `npm run test:2fa` includes `server/auth/sso.test.ts` (mock provider signing real tokens).

## First signup on an empty database; existing finance is not claimed

Finance rows are scoped by `user_id` in `data/portfolio.db`.

When the **first** account is created on a database with **no** holdings, bank accounts, transactions, or other finance/bank rows:

1. `meta.data_owner_user_id` is set to that user.
2. Unscoped budget-category seeds are backfilled to that user_id.

A database that **already has** finance or bank rows (for example a hosted volume with Kiwibank/Akahu data and zero users) does **not** hand those rows to whoever registers first. The account is created with an empty ledger and is not the data owner. To claim those rows on purpose, set the server environment variable `ALLOW_EXISTING_DATA_CLAIM=1` before that first signup (not a field on the register request). Leave it unset after.

**Later accounts** get an **empty** ledger (no holdings/txns/accounts with their `user_id`) plus a **fresh copy** of default budget categories. They choose asset-class toggles on signup and may **Skip / do later** on Akahu Connect. APIs always filter by session `user_id`. Per-user Akahu OAuth tokens live in `akahu_connections` (Full App); the Personal App `AKAHU_USER_TOKEN` is data-owner only.

## How-to (Nathan)

1. Restart the API after pulling these changes (`npm run dev` or your usual start script).
2. Hard-refresh the browser (Ctrl+Shift+R / Cmd+Shift+R) so the new login UI loads.
3. Open http://127.0.0.1:3000 — you should land on **Create account** (first time) or **Sign in**.
4. Create your account with the email you want, then complete **asset classes** and **budget categories** (required). The Akahu checkpoint is shown before the dashboard; connecting is optional and it can be skipped. Existing portfolio data stays available for the first account.
5. **Sign out** clears the session cookie; finance pages and APIs stop returning data until you sign in again.

Akahu tokens and `.env` stay server-side only — never sent to the browser.

## Signup onboarding (required steps)

Create account is a **multi-step** flow. The dashboard is blocked until the required steps are done, including explicitly passing through the optional Akahu checkpoint:

1. **Email + password** — creates the local account and session.
2. **Asset classes** (required, no skip) — toggle Stocks, Crypto, GoMining, Metals, Forex, Real estate, Art, Precious stones, Collectables, KiwiSaver, Cash/Banks. Saved to `users.preferences_json.assetClasses` and marks `onboarding.assetClassesDone`.
3. **Budget categories** (required, no skip) — review/add/remove spending & income categories (`budget_categories`), then confirm. Marks `onboarding.budgetCategoriesDone`.
4. **Akahu checkpoint** (optional, skippable) — open Akahu and sync linked banks / investments, or choose **Skip / do later**. Either action records that the step was seen before the portfolio opens.

New accounts start with `preferences_json.onboarding = { assetClassesDone: false, budgetCategoriesDone: false, akahuStepDone: false }`. Legacy accounts without an `onboarding` block are treated as already complete (not locked out).

`AuthUser.onboardingComplete` is returned from `/api/auth/me` (and login/register). The UI gate (`RequireAuth`) sends incomplete users back to `/register`, which resumes at the unfinished step. Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) after pulling so the new Register UI loads.

Asset class choices can still be changed later under **Settings → Categories & assets**. Disabled classes are hidden in Portfolio, Dashboard tiles/charts, and related nav (data remains in `data/`), and are left out of net worth, Projections and History (`src/lib/visibleNetWorth.ts`, applied when figures are read; snapshots keep every class).

## Akahu connections

Bank / investment linking is separate from local email/password auth. See [AKAHU_CONNECT.md](./AKAHU_CONNECT.md). Per-user OAuth tokens (Full App) live in `akahu_connections` and are never sent to the browser; Personal App still uses a shared `AKAHU_USER_TOKEN` in `.env`.

## Profile & account settings

- **Header avatar** — click the profile picture (or initials) for account owner name/email, **Settings**, and **Sign out**.
- **Settings → Account** — *Profile* (photo with preview before saving, stored under `data/uploads/avatars/` or as a data URL on `users.avatar_url`; first/last name saved as typed), *Email and password* (email row with an inline Change form, current password required, confirmed by email link when email is set up; password row links to Settings → Security), *Your data* (Download a copy), the ad preferences, and a collapsed **Delete account** with *Deleted* / *Kept* lists from `src/lib/accountView.ts` — keep those lists in step with the delete route below.
- **Settings → Categories & assets** — asset-class switches (`users.preferences_json`, saved on change) and **your** transaction categories (`budget_categories.user_id`); deleting one in use moves everything to another category of the same type.
- **Settings → Connections** — Akahu connect, Sync now, Refresh.

## Change email, download a copy

**Change email** (Settings → Account → Email → Change) needs the current password. When email sending is set up (`RESEND_API_KEY` + `INVOICE_EMAIL_FROM`, see INVOICES.md), the new address gets a link (`/confirm-email#token=…`, 24 h, one use, one pending change per account in `email_changes`, token stored hashed) and the current address gets a notice. Nothing changes until the link's page is opened and **Confirm** pressed (a POST, so mail scanners can't confirm). The current email keeps working meanwhile; **Cancel change** drops it. Without email sending the change applies at once and the form says so. Google / Apple / Microsoft sign-ins are matched by the provider's account id, so they stay linked.

**Download a copy** (`GET /api/auth/export`, Settings → Account → Your data) returns JSON of every per-user table (`SCOPED_TABLES`) plus their child rows, profile, sign-in methods and history, household membership and shared prices. Password and token hashes, encrypted secrets, share-link tokens and Akahu tokens are left out (`server/lib/accountExport.ts`). Uploaded files are listed by name only.

## Delete account

**Settings → Account → Delete account…** requires typing `DELETE` and the current password. Accounts without a password set one in Security first (or email us).

`POST /api/auth/delete-account` `{ password, confirm: "DELETE" }` then:

1. Deletes **this user's** rows in every `SCOPED_TABLES` table and their child rows (`debt_repayments`, `kiwisaver_activity`, `kiwisaver_balance_history`, deleted explicitly: `PRAGMA foreign_keys` is off, so `ON DELETE CASCADE` never fires), plus holding photos, receipts and payslip files under `data/uploads/`, and supermarket prices they shared.
2. Household: an owned household with no adult heir is deleted; otherwise they leave it. Their shares and shared pay go, their activity entries become "Former member" with details cleared, other entries naming them say "a former member", and invites they sent that weren't accepted are deleted. Splits and settlements stay for the others (amounts affect what they owe) and show "Former member".
3. Deletes avatar file, sessions, Akahu connection, 2FA backup codes, trusted devices, pending sign-ins, provider links, passkeys, sign-in history, plan (`user_entitlements`), pending email change, and the `users` row (including `preferences_json`).
4. If they were `data_owner_user_id`, the role is **cleared, not reassigned**: it unlocks the server's shared Akahu Personal App token (that owner's bank feed) and the owner's legacy GoMining / collectable values in `app_settings`, which are deleted too. Set a new owner by hand only if that's intended.
5. Clears the session cookie. Other users' rows are untouched.

The page's Deleted / Kept lists live in `src/lib/accountView.ts`; keep them, this section and the privacy policy in step. Tests: `npm run test:account`.

### Shared data that remains

| Shared | Notes |
|--------|--------|
| `app_settings` | Locale, currency, timezone defaults |
| `price_quotes`, `economic_*` | Public prices, rates and economic figures; not linked to anyone |
| `meta` | `schema_version` etc. |
| `.env` Akahu Personal App token | Server env, not per user |

Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) after pulling so the Delete account UI loads.
