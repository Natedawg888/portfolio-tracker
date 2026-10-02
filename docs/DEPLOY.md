# Deploy (Week 2) — Host + harden

**Host choice: Railway** (Docker). One service serves the Vite SPA + Express API.
SQLite stays on a **persistent volume** at `/app/data` (sql.js is deeply embedded — no Postgres rewrite this week).

## What Nathan does once

1. Sign in at [railway.app](https://railway.app) (GitHub login is fine).
2. **New Project → Deploy from GitHub** → `Natedawg888/portfolio-tracker`.
3. Select branch **`alpha`** for staging, or `main` when you promote.
4. Railway detects `Dockerfile` + `railway.toml`.
5. **Volumes** → add a volume, mount path **`/app/data`**.
6. **Variables** → paste from `.env.production.example` with real secrets:
   - `COOKIE_SECURE=true`
   - `TRUST_PROXY=1`
   - `PUBLIC_URL`, `AKAHU_REDIRECT_URI`, `AKAHU_FRONTEND_URL` = your Railway HTTPS domain
   - Akahu + optional `METALS_API_KEY`
7. **Settings → Networking → Generate Domain**.
8. Register the same HTTPS callback URL on the Akahu Full App.

Secrets stay on Railway only — never commit `.env`.

## Local production smoke

```bash
npm ci
npm run build
# copy .env.production.example → .env.production and fill locally if needed
set HOST=0.0.0.0
set PORT=8080
set NODE_ENV=production
npm run start
```

Open `http://127.0.0.1:8080` — API and UI from one process.

## Backup story (SQLite)

- Live DB: `data/portfolio.db` (or `DATABASE_PATH`).
- **Daily backup:** `npm run db:backup` → `data/backups/portfolio-YYYYMMDD-HHMMSS.db`
- **Restore:** `npm run db:restore -- data/backups/<file>.db` (overwrites live DB — stop the API first).
- On Railway: volume keeps `/app/data` across deploys; still run backups (Railway cron service, or download volume periodically).
- Postgres remains optional later; this week prefers backups over a sql.js rewrite.

## Health / logs

- `GET /api/health` — uptime/load balancer check (public).
- Structured JSON logs to stdout (`LOG_FORMAT=json`) for Railway log drain.
- Quote providers keep **last-good / stale** on Metals.Dev / CoinGecko / Yahoo failure — never invent prices.
- Silent Akahu auto-sync failures → quiet toast; tables keep last loaded data.

## Fly / Render

Same `Dockerfile` works. Prefer Railway docs above; for Fly: `fly launch` + volume `data` at `/app/data`.
