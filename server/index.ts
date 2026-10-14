/**
 * NZD portfolio tracker API (+ production static SPA).
 * Dev: Vite proxies /api → this process on :8787 (HOST default 127.0.0.1).
 * Prod: HOST=0.0.0.0, serves dist/ + /api on PORT (Railway/Fly/Render).
 * Data: ./data/portfolio.db (sql.js) — mount a volume at /app/data when hosted.
 */
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb, DB_PATH } from './db/index.ts';
import holdingsRouter from './routes/holdings.ts';
import accountsRouter from './routes/accounts.ts';
import budgetsRouter from './routes/budgets.ts';
import kiwisaverRouter from './routes/kiwisaver.ts';
import summaryRouter from './routes/summary.ts';
import akahuRouter from './routes/akahu.ts';
import quotesRouter from './routes/quotes.ts';
import settingsRouter from './routes/settings.ts';
import debtsRouter from './routes/debts.ts';
import incomeRouter from './routes/income.ts';
import homeRouter from './routes/home.ts';
import dividendsRouter from './routes/dividends.ts';
import payeesRouter from './routes/payees.ts';
import savingsGoalsRouter from './routes/savingsGoals.ts';
import donationsRouter from './routes/donations.ts';
import paySourcesRouter from './routes/paySources.ts';
import invoicesRouter from './routes/invoices.ts';
import publicInvoicesRouter from './routes/publicInvoices.ts';
import recurringRouter from './routes/recurring.ts';
import warrantiesRouter from './routes/warranties.ts';
import rentalsRouter from './routes/rentals.ts';
import adsRouter from './routes/ads.ts';
import healthScoreRouter from './routes/healthScore.ts';
import projectionsRouter from './routes/projections.ts';
import walletsRouter from './routes/wallets.ts';
import { startWalletSyncScheduler } from './chain/index.ts';
import authRouter from './routes/auth.ts';
import securityRouter from './routes/security.ts';
import ssoRouter from './routes/sso.ts';
import passkeysRouter from './routes/passkeys.ts';
import economyRouter from './routes/economy.ts';
import newsRouter from './routes/news.ts';
import { loadDotEnv } from './akahu/loadEnv.ts';
import { ensureUploadDirs, uploadsGate } from './lib/uploads.ts';
import { attachUser, requireAuth, isPublicApiPath } from './middleware/requireAuth.ts';
import { logger } from './lib/logger.ts';

/** Requests at or above this many ms also log a slow_request warning. */
const SLOW_REQUEST_MS = 300;
import { apiNotFound, mountSpa } from './lib/spaHost.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
/** Optional absolute override for routing tests. The image uses ./dist. */
const DIST_DIR = process.env.SPA_DIST_DIR?.trim()
  ? path.resolve(process.env.SPA_DIST_DIR.trim())
  : path.join(ROOT, 'dist');
const isProd = process.env.NODE_ENV === 'production';

const PORT = Number(process.env.PORT ?? 8787);
/** Bind all interfaces in production (container / PaaS); loopback for local dev. */
const HOST = process.env.HOST ?? (isProd ? '0.0.0.0' : '127.0.0.1');

function trustProxySetting(): boolean | number {
  const raw = (process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes') return 1;
  if (/^\d+$/.test(raw)) return Number(raw);
  // Default: trust one hop in production (Railway/Fly TLS terminator).
  return isProd ? 1 : false;
}

async function main() {
  loadDotEnv();
  if (isProd && fs.existsSync(path.join(ROOT, '.env.production'))) {
    // Optional local prod smoke; Railway injects env — never required in git.
    loadDotEnv('.env.production', { force: true });
  }
  await getDb();
  const app = express();

  const trust = trustProxySetting();
  if (trust !== false) {
    app.set('trust proxy', trust);
  }

  // Vite proxies /api → this server; credentials needed for session cookie.
  // In production the SPA is same-origin; cors still helps preview/alternate origins.
  const corsOrigin = process.env.CORS_ORIGIN?.trim();
  app.use(
    cors({
      origin: corsOrigin ? corsOrigin.split(',').map((s) => s.trim()) : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '10mb' })); // property photos as base64
  ensureUploadDirs();

  // Request logging (no bodies / cookies).
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/health' || req.path === '/health') {
        if (res.statusCode < 400) return; // quiet successful health checks
      }
      const ms = Date.now() - started;
      const fields = { method: req.method, path: req.path, status: res.statusCode, ms, ip: req.ip };
      logger.info('http_request', fields);
      // A separate line for slow requests, so they are easy to find in the logs.
      if (ms >= SLOW_REQUEST_MS) logger.warn('slow_request', fields);
    });
    next();
  });

  // Resolve session user on every /api request
  app.use('/api', attachUser);

  // Gate finance data: anything under /api except auth + health
  app.use('/api', (req, res, next) => {
    if (isPublicApiPath(req.path)) return next();
    return requireAuth(req, res, next);
  });

  app.use('/api/auth', authRouter);
  app.use('/api/auth', securityRouter);
  app.use('/api/auth', ssoRouter);
  app.use('/api/auth', passkeysRouter);
  // Uploads are files under /api. GET/HEAD only so a POST cannot 405 here.
  app.use('/api/uploads', uploadsGate());

  app.use('/api/holdings', holdingsRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/kiwisaver', kiwisaverRouter);
  app.use('/api', summaryRouter);
  app.use('/api/akahu', akahuRouter);
  app.use('/api/quotes', quotesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/debts', debtsRouter);
  app.use('/api/income', incomeRouter);
  app.use('/api/home', homeRouter);
  app.use('/api/dividends', dividendsRouter);
  app.use('/api/payees', payeesRouter);
  app.use('/api/savings-goals', savingsGoalsRouter);
  app.use('/api/donations', donationsRouter);
  app.use('/api/pay-sources', paySourcesRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/public', publicInvoicesRouter);
  app.use('/api/recurring', recurringRouter);
  app.use('/api/warranties', warrantiesRouter);
  app.use('/api/rentals', rentalsRouter);
  app.use('/api/ads', adsRouter);
  app.use('/api/health-score', healthScoreRouter);
  app.use('/api/projections', projectionsRouter);
  app.use('/api/economy', economyRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/wallets', walletsRouter);

  // Unmatched /api stops here (JSON). It must not fall through to the SPA.
  app.use('/api', apiNotFound);

  // Production: Vite build from this same process. Static is GET/HEAD only.
  if (isProd && fs.existsSync(DIST_DIR)) {
    mountSpa(app, DIST_DIR);
  }

  // Express 5: the listen callback is also wired to server 'error' (via once).
  const server = app.listen(PORT, HOST, (err?: Error) => {
    if (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        logger.error('port_in_use', { port: PORT, host: HOST });
        console.error(`[portfolio-tracker] Port ${PORT} is already in use (${HOST}).`);
        console.error(
          `[portfolio-tracker] Free it (Windows): netstat -ano | findstr :${PORT}   then   taskkill /PID <pid> /F`,
        );
        console.error(
          `[portfolio-tracker] Or pick another port: set PORT=8788&& npm run dev`,
        );
        process.exit(1);
      }
      logger.error('listen_failed', { err: String(err) });
      console.error('[portfolio-tracker] Failed to start API:', err);
      process.exit(1);
    }
    const stopWalletSync = startWalletSyncScheduler();
    server.once('close', stopWalletSync);
    logger.info('api_listening', {
      host: HOST,
      port: PORT,
      db: DB_PATH,
      prod: isProd,
      spa: isProd && fs.existsSync(DIST_DIR),
      trustProxy: trust,
      publicUrl: process.env.PUBLIC_URL ?? null,
    });
    console.log(`[portfolio-tracker] API http://${HOST}:${PORT}`);
    console.log(`[portfolio-tracker] SQLite (sql.js) → ${DB_PATH}`);
    console.log(`[portfolio-tracker] Currency NZD · TZ Pacific/Auckland`);
    console.log(`[portfolio-tracker] Auth: email/password + httpOnly session cookie`);
    if (isProd && fs.existsSync(DIST_DIR)) {
      console.log(`[portfolio-tracker] Serving SPA from ${DIST_DIR}`);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('port_in_use', { port: PORT, host: HOST });
      console.error(`[portfolio-tracker] Port ${PORT} is already in use (${HOST}).`);
      process.exit(1);
    }
  });

  const shutdown = (signal: string) => {
    logger.info('shutdown', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('fatal', { err: String(err) });
  console.error(err);
  process.exit(1);
});
