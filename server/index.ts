/**
 * Local API for NZD portfolio tracker.
 * Listens on 8787. Data: ./data/portfolio.db (sql.js).
 */
import express from 'express';
import cors from 'cors';
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
import authRouter from './routes/auth.ts';
import { loadDotEnv } from './akahu/loadEnv.ts';
import path from 'node:path';
import { DATA_DIR } from './db/index.ts';
import { ensureUploadDirs } from './lib/uploads.ts';
import { attachUser, requireAuth, isPublicApiPath } from './middleware/requireAuth.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

async function main() {
  loadDotEnv();
  await getDb();
  const app = express();

  // Vite proxies /api → this server; credentials needed for session cookie
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '10mb' })); // property photos as base64
  ensureUploadDirs();

  // Resolve session user on every /api request
  app.use('/api', attachUser);

  // Gate finance data: anything under /api except auth + health
  app.use('/api', (req, res, next) => {
    if (isPublicApiPath(req.path)) return next();
    return requireAuth(req, res, next);
  });

  app.use('/api/auth', authRouter);
  app.use('/api/uploads', express.static(path.join(DATA_DIR, 'uploads')));

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

  // Express 5: the listen callback is also wired to server 'error' (via once).
  // On EADDRINUSE it is invoked with the Error — ignoring that used to print
  // "API listening" then exit 0 (no open handle), and concurrently -k killed Vite.
  const server = app.listen(PORT, HOST, (err?: Error) => {
    if (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        console.error(`[portfolio-tracker] Port ${PORT} is already in use (${HOST}).`);
        console.error(
          `[portfolio-tracker] Free it (Windows): netstat -ano | findstr :${PORT}   then   taskkill /PID <pid> /F`,
        );
        console.error(
          `[portfolio-tracker] Or pick another port: set PORT=8788&& npm run dev`,
        );
        process.exit(1);
      }
      console.error('[portfolio-tracker] Failed to start API:', err);
      process.exit(1);
    }
    console.log(`[portfolio-tracker] API http://${HOST}:${PORT}`);
    console.log(`[portfolio-tracker] SQLite (sql.js) → ${DB_PATH}`);
    console.log(`[portfolio-tracker] Currency NZD · TZ Pacific/Auckland`);
    console.log(`[portfolio-tracker] Auth: email/password + httpOnly session cookie`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    // Belt-and-suspenders if listen is called without the Express callback path
    if (err.code === 'EADDRINUSE') {
      console.error(`[portfolio-tracker] Port ${PORT} is already in use (${HOST}).`);
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
