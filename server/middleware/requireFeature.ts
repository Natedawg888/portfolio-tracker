/**
 * Route guard for a plan feature (server/lib/entitlements.ts). Without it the request gets
 * 402 with a code the client turns into an upgrade note, e.g. BUSINESS_PLAN_REQUIRED.
 */
import type { NextFunction, Response } from 'express';
import { getDb } from '../db/index.ts';
import { hasFeature, type Feature } from '../lib/entitlements.ts';
import type { AuthedRequest } from './requireAuth.ts';

const MESSAGES: Partial<Record<Feature, { code: string; error: string }>> = {
  business_reports: { code: 'BUSINESS_PLAN_REQUIRED', error: 'Reports, the GST return and the accountant export are part of KoruLedger Business.' },
};

export function requireFeature(feature: Feature) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
      return;
    }
    const db = await getDb();
    if (hasFeature(db, req.user.id, feature)) {
      next();
      return;
    }
    const m = MESSAGES[feature] ?? { code: 'PLAN_REQUIRED', error: 'Your plan doesn’t include this.' };
    res.status(402).json(m);
  };
}
