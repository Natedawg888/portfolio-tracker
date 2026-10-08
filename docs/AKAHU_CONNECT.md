# Connect banks, investments & KiwiSaver (Akahu)

Research / how-to date: **2026-10-02** (Pacific/Auckland).

Portfolio Tracker uses **[Akahu](https://akahu.nz)** as the sanctioned NZ open-banking / investment aggregator. Users never type bank or Sharesies passwords into this app - they complete consent in **Akahu's hosted UI** (and their bank's official open-banking screens where applicable).

## What Akahu can link (NZ)

### Banks (enduring account data)

ANZ, ASB, BNZ, The Co-operative Bank, Heartland, Kiwibank, NZHL, Rabobank, SBS, TSB, Westpac - balances and (where supported) transactions / payments.  
Source: [Akahu integrations](https://developers.akahu.nz/docs/integrations)

### Funds & investment platforms

Booster, Fisher Funds, Generate, **Hatch**, Kernel Wealth, Milford, Pie Funds, **Sharesies**, Sharesight, Simplicity, Stake, Superlife - **account data** (portfolio holdings / balances). Parties data varies by provider.

### KiwiSaver

- **Via Sharesies KiwiSaver** (investment platform integration): observed live as Akahu `type: KIWISAVER` with `balance.current` + `meta.portfolio[]` fund mix. See [SHARESIES_KIWISAVER.md](./SHARESIES_KIWISAVER.md).
- **Via bank open banking:** KiwiSaver / managed fund / FX products are **not** available on official bank OB matrices (e.g. Kiwibank). Use the provider's own Akahu connection (Sharesies, Simplicity, etc.) instead.

### Official open banking vs classic

Since Dec 2025 Akahu is an accredited requestor for NZ CDR-style open banking. Classic reverse-engineered connections remain for many non-bank providers. The tracker always talks to **Akahu's unified API** (`https://api.akahu.io/v1`).

---

## Two ways this app authenticates

| Mode | Env | Who's data | Connect UI |
| --- | --- | --- | --- |
| **Personal App** (data-owner only) | `AKAHU_APP_ID` + `AKAHU_USER_TOKEN` | **Only the first/data-owner user** may sync via the shared env token. Later local users stay empty (no Nathan dump). | Owner: connect banks at [my.akahu.nz](https://my.akahu.nz), then use onboarding **Sync & finish**. Others: onboarding **Skip / do later** / empty until Full App OAuth |
| **Full App OAuth** (multi-user) | `AKAHU_APP_ID` + `AKAHU_APP_SECRET` + `AKAHU_REDIRECT_URI` | **Per local user** - each signup can Connect their own Akahu into their own `user_id` rows | Settings / onboarding **Connect with Akahu** (onboarding **Skip / do later** allowed) |

Honest gap: **Personal Apps cannot run the OAuth authorization-code flow** ([Akahu docs](https://developers.akahu.nz/docs/authorizing-with-oauth2)). Per-user Connect for additional accounts requires a **Full App** from Akahu. Until then, the onboarding step offers **Open Akahu** for the owner, then **Sync & finish**; users who do not connect can choose **Skip / do later** and still reach an empty dashboard.

Nathan's Side deploy typically uses the **Personal App shared token** (owner only). OAuth code activates when `AKAHU_APP_SECRET` (+ redirect URI) are present.


---

## What Nathan needs in `.env`

Never commit `.env`. Never put tokens in the browser.

```env
# Always (Personal or Full)
AKAHU_APP_ID=app_token_…

# Personal App (shared household) - paste User Access Token from my.akahu.nz → Developers
AKAHU_USER_TOKEN=user_token_…

# Full App OAuth (optional - enables Settings → Connect with Akahu per user)
AKAHU_APP_SECRET=…
# Encrypts akahu_connections.access_token at rest (AES-256-GCM). 32 bytes, base64 or 64 hex chars.
# Required in production before a new token is stored. Do not commit the key.
# Existing plaintext rows still open, and are encrypted on the next read when this is set.
AKAHU_TOKEN_ENCRYPTION_KEY=
# Must exactly match a Redirect URI registered on the Akahu app:
AKAHU_REDIRECT_URI=http://127.0.0.1:3000/api/akahu/callback
# Where the browser returns after OAuth (Settings):
AKAHU_FRONTEND_URL=http://127.0.0.1:3000
```

### Personal App setup (Nathan-only / household)

1. Sign in at [my.akahu.nz](https://my.akahu.nz) → MFA → **Developers** → create **Personal App**.
2. Copy **App ID Token** → `AKAHU_APP_ID`, **User Access Token** → `AKAHU_USER_TOKEN`.
3. In Akahu, **connect** Kiwibank, Sharesies, Hatch, etc. Complete bank OB consent in the bank app/web.
4. During signup, return to Portfolio Tracker and choose **Sync & finish** (or use Settings → Sync now later).
5. Restart the API (`npm run dev`). Open Portfolio / Spending / KiwiSaver → Sync, or **Settings → Sync now**.

### Full App OAuth setup (per-user Connect)

1. Obtain a Full App (Akahu: `hello@akahu.nz` / Slack). Register redirect URI = `AKAHU_REDIRECT_URI`.
2. Put `AKAHU_APP_ID`, `AKAHU_APP_SECRET`, `AKAHU_REDIRECT_URI` in `.env` (and optional `AKAHU_FRONTEND_URL`).
3. User signs into Portfolio Tracker → **Settings → Connect accounts → Connect with Akahu** (or the onboarding step).
4. Browser goes to `https://oauth.akahu.nz` → user picks institutions → redirect to `/api/akahu/callback`.
5. Server exchanges `code` for a **user access token**, stores it in `akahu_connections` (sqlite, server-only, encrypted when `AKAHU_TOKEN_ENCRYPTION_KEY` is set), then syncs portfolio + transactions.
6. **Disconnect** revokes the token at Akahu (`DELETE /token`) and deletes the local row. Shared `AKAHU_USER_TOKEN` is never revoked by Disconnect.

---

## In-app flows

| Action | Where |
| --- | --- |
| Start Connect / Reconnect | Settings → Connect accounts; also post-signup "Connect banks & investments" |
| See institutions | Settings (cached from last `/accounts`); Refresh institution list |
| Sync holdings / KS / cash | Settings → Sync now; Portfolio / Dashboard / KiwiSaver sync buttons |
| Sync bank transactions | Spending sync; Settings Sync now |
| Disconnect (OAuth only) | Settings → Disconnect |

API (auth required except callback):

- `GET /api/akahu/status` - mode, oauthReady, institutions, multiUser
- `POST /api/akahu/connect` - `{ authorizeUrl }`
- `GET /api/akahu/callback` - OAuth redirect (public; CSRF `state`)
- `GET /api/akahu/institutions`
- `POST /api/akahu/disconnect`
- `POST /api/akahu/sync` · `POST /api/akahu/sync-transactions`

---

## Sandbox vs live

Akahu's enduring integrations above are **live production institutions**. There is no separate "fake bank" path in this tracker. Development against Personal App credentials hits **real** linked accounts after you consent. Official open-banking migration timelines (classic → OB) are Akahu's; the tracker API surface stays the same.

---

## Security

- App secret + user tokens: **server only** (`.env` or `akahu_connections.access_token`).
- OAuth user tokens in `akahu_connections.access_token` are encrypted with `AKAHU_TOKEN_ENCRYPTION_KEY` (32-byte key, base64 or 64 hex characters; see `.env.example`). The key is not in the repo. Production refuses to store a new token when the key is missing. Rows written before the key existed stay readable and are encrypted on the next read. Tokens are not written to logs.
- Never collect bank / Sharesies / Hatch passwords.
- Prefer read-only scopes (`ENDURING_CONSENT` without payments) for this tracker. There is no payments scope.
- On `401` from Akahu, prompt Reconnect (OAuth) or refresh the Personal App user token.

Cross-links: [KIWIBANK_PLAN.md](./KIWIBANK_PLAN.md) · [SHARESIES_KIWISAVER.md](./SHARESIES_KIWISAVER.md) · [AUTH.md](./AUTH.md)
