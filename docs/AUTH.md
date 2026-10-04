# Local auth (email / password)

Portfolio Tracker uses **local accounts** on the machine running the API. No third-party OAuth.

## How it works

- **Create account** — email + password (min 8 chars, letter + number).
- **Login / logout** — session stored as an **httpOnly** cookie (`pt_sid`). Raw token never lands in `localStorage`.
- **Passwords** — hashed with Node **scrypt** (`scrypt$N$r$p$salt$hash`). Plaintext is never stored.
- **Sessions** — random token in cookie; **SHA-256 hash** only in `sessions` table (sql.js). TTL ≈ 30 days.
- **API gate** — all `/api/*` routes except `/api/auth/*` and `/api/health` require a valid session.
- **UI gate** — unauthenticated users only see `/login` or `/register`.

## First signup claims existing data; later users start empty

Finance rows are scoped by `user_id` in `data/portfolio.db`.

When the **first** account is created:

1. `meta.data_owner_user_id` is set to that user.
2. All existing holdings, accounts, transactions, etc. are backfilled to that user_id.

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

Asset class choices can still be changed later under **Settings → Categories / assets**. Disabled classes are hidden in Portfolio, Dashboard buckets/charts, and related nav (data remains in `data/`).

## Akahu connections

Bank / investment linking is separate from local email/password auth. See [AKAHU_CONNECT.md](./AKAHU_CONNECT.md). Per-user OAuth tokens (Full App) live in `akahu_connections` and are never sent to the browser; Personal App still uses a shared `AKAHU_USER_TOKEN` in `.env`.

## Profile & account settings

- **Header avatar** — click the profile picture (or initials) for account owner name/email, **Settings**, and **Sign out**.
- **Settings → Account** — display name, upload/remove profile picture (stored under `data/uploads/avatars/` or as a data URL on `users.avatar_url`), change email / password (current password required), **delete account**.
- **Settings → Categories / assets** — asset-class toggles (`users.preferences_json`), add/remove **your** transaction categories (`budget_categories.user_id`), plus Akahu connect.

## Delete account

**Settings → Account → Delete account…** requires typing `DELETE` and the current password.

`POST /api/auth/delete-account` `{ password, confirm: "DELETE" }` then:

1. Deletes **this user’s** scoped finance rows only (`holdings`, `bank_accounts`, `transactions`, `kiwisaver_accounts` + cascaded history/activity, `debt_people` + cascaded repayments, `income_records`, `income_plans`, `dividend_events`, `payee_settings`, `budgets`, `valuation_snapshots`) and their holding photos under `data/uploads/`. The user’s KiwiSaver employee rate is removed with `preferences_json`.
2. Deletes avatar file, all `sessions` for the user, `akahu_connections` for the user, and the `users` row (including `preferences_json`).
3. Clears the session cookie. Does **not** wipe other users’ `user_id` rows.
4. If the deleted user was `data_owner_user_id`, ownership is reassigned to the oldest remaining user (or cleared if none left).

### Shared data that remains

These stay **global** on this machine — account delete does not remove them:

| Shared | Notes |
|--------|--------|
| `app_settings` | GoMining params, collectable types, locale/currency |
| `price_quotes` | Shared quote cache |
| `meta` | `schema_version` etc.; `data_owner_user_id` cleared/reassigned as above |
| `.env` Akahu Personal App token | Server env — not stored per user |

`budget_categories` are **per-user** (own seed copy + customs). Deleted with the account.

Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) after pulling so the Delete account UI loads.
