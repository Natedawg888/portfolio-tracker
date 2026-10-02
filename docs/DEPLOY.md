# Deploy (Week 2) — Host + harden

**Host choice: Railway** (Docker). **One service** serves the Vite SPA + Express API (`npm run start`).
SQLite stays on a **persistent volume** at `/app/data` (sql.js is deeply embedded — no Postgres rewrite this week).

`GET /api/health` is implemented in `server/routes/summary.ts` and returns JSON:

```json
{ "ok": true, "schemaVersion": "...", "currency": "NZD", "startedAt": "...", "uptimeSec": 1 }
```

`POST /api/auth/login` and `POST /api/auth/register` return JSON (200/201 or a 4xx business error). They must never return **405**.

## What Nathan does once

### One service, Dockerfile — not a static site

`railway.toml` sets `builder = "DOCKERFILE"`. The Railway dashboard can still override that and publish **only** the Vite `dist/` tree (Railpack, Nixpacks, or a "Static" service). That host answers every GET with `index.html` and every POST with **405** `Allow: GET, HEAD`. Express is not in the path, so API code cannot fix it.

Checked **2026-10-02** against `https://portfolio-tracker-production-c160.up.railway.app`:

| Request | Result | What a Docker deploy returns |
| --- | --- | --- |
| `GET /api/health` | **200** `text/html` (SPA `index.html`, same etag as `/`) | **200** `application/json` with `"ok": true` |
| `POST /api/auth/login` | **405**, `Allow: GET, HEAD`, empty body | JSON **401** `INVALID_CREDENTIALS` (or **400**) |
| `POST /api/auth/register` | **405**, `Allow: GET, HEAD`, empty body | JSON **201** or **4xx** (`INVALID_EMAIL`, `EMAIL_TAKEN`, …) |

Response headers on that domain (`server: railway-hikari`, file `etag`, `last-modified`) are the static edge. This repo's health route was already JSON when that was captured — the public domain is not running the image. **Redeploy the Dockerfile service** after fixing the builder; the old static deployment keeps 405 until then.

On the service:

1. Sign in at [railway.app](https://railway.app) (GitHub login is fine).
2. **New Project → Deploy from GitHub** → `Natedawg888/portfolio-tracker`.
3. Select branch **`alpha`** for staging, or `main` when you promote.
4. **One service only.** Do not add a second static-site service for `dist/`, and do not attach the public domain to one.
5. **Settings → Build** (config-as-code from repo root):
   - Builder: **Dockerfile** (`dockerfilePath = "Dockerfile"` in `railway.toml`)
   - Root directory: repo root, **not** `dist/`
   - Config file: `railway.toml`
   - No static output directory, no start command of `vite preview` / `npx serve` / Railpack static
   - Leave start command empty so the image `CMD` runs (`npm run start` → Express on `PORT`, `NODE_ENV=production`)
6. If the UI shows Railpack, Nixpacks, or Static, switch it to Dockerfile and **redeploy**.

### Volume, variables, domain, healthcheck

7. **Volumes** → add a volume, mount path **`/app/data`**.
8. **Variables** → paste from `.env.production.example` with real secrets:
   - `COOKIE_SECURE=true`
   - `TRUST_PROXY=1`
   - `PUBLIC_URL`, `AKAHU_REDIRECT_URI`, `AKAHU_FRONTEND_URL` = your Railway HTTPS domain
   - Akahu + optional `METALS_API_KEY`
9. **Settings → Networking → Generate Domain** on **this** Docker service.
10. **Settings → Deploy**: healthcheck path **`/api/health`** (`railway.toml` `healthcheckPath`). It must be **200** and JSON containing `"ok": true`. An HTML 200 will go green on a static host and still break login.
11. Register the same HTTPS callback URL on the Akahu Full App.

Secrets stay on Railway only — never commit `.env`.

### Prove the domain hits Express

```bash
curl -si https://<your-domain>/api/health
curl -si -X POST https://<your-domain>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.com","password":"nope"}'
```

Healthy: health is `content-type: application/json` and `"ok":true`. Login is JSON, never `405` / `Allow: GET, HEAD`.

Still on the static site: health body starts with `<!doctype html>`, or POST is 405. Change the builder to Dockerfile and redeploy. The in-process static guard (GET/HEAD assets only, `/api` never falls through to the SPA) applies only after that process is what the domain hits.

## Local production smoke

`npm run start` is `node --import tsx server/index.ts`. **`tsx` is a production dependency** so the image install `npm ci --omit=dev` still includes it. A follow-up `npm install tsx --no-save` while `NODE_ENV=production` does not: npm prunes that package, and the container exits with `ERR_MODULE_NOT_FOUND` for `tsx`.

```bash
npm ci
npm run build
# copy .env.production.example → .env.production and fill locally if needed
set HOST=0.0.0.0
set PORT=8080
set NODE_ENV=production
npm run start
```

Same start after a production-only install (what the Dockerfile runs):

```bash
npm ci --omit=dev
set NODE_ENV=production
npm run start
```

Open `http://127.0.0.1:8080` — API and UI from one process. `GET /api/health` is JSON.

## Backup story (SQLite)

- Live DB: `data/portfolio.db` (or `DATABASE_PATH`).
- **Daily backup:** `npm run db:backup` → `data/backups/portfolio-YYYYMMDD-HHMMSS.db`
- **Restore:** `npm run db:restore -- data/backups/<file>.db` (overwrites live DB — stop the API first).
- On Railway: volume keeps `/app/data` across deploys; still run backups (Railway cron service, or download volume periodically).
- Postgres remains optional later; this week prefers backups over a sql.js rewrite.

## Health / logs

- `GET /api/health` — public JSON `{ "ok": true, ... }` for Railway's healthcheck. Same process as the SPA; not a separate static host.
- Structured JSON logs to stdout (`LOG_FORMAT=json`) for Railway log drain.
- Quote providers keep **last-good / stale** on Metals.Dev / CoinGecko / Yahoo failure — never invent prices.
- Silent Akahu auto-sync failures → quiet toast; tables keep last loaded data.

## Fly / Render

Same `Dockerfile` works. Prefer Railway docs above; for Fly: `fly launch` + volume `data` at `/app/data`.
