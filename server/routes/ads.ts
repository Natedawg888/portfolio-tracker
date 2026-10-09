/**
 * Ad banners config (KAN-72). Public: no user data in or out.
 *   GET /config   { mode, clientId, slots }
 * Env is read on every request, so ADS_ENABLED=false turns ads off with a restart, not a build.
 */
import { Router } from 'express';
import { adsConfigFromEnv } from '../../src/lib/ads.ts';

const router = Router();

router.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(adsConfigFromEnv(process.env, process.env.NODE_ENV === 'production'));
});

export default router;
