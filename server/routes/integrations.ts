/**
 * Payment providers for invoices (KAN-73).
 *   GET    /api/integrations                       what's connected and what this server can do
 *   GET    /api/integrations/stripe/connect        { url } to Stripe Connect OAuth
 *   GET    /api/integrations/stripe/callback       OAuth return (browser redirect)
 *   DELETE /api/integrations/stripe                disconnect
 *   PUT    /api/integrations/paddle                { apiKey, webhookSecret } connect (sandbox keys)
 *   DELETE /api/integrations/paddle                disconnect
 *   GET    /api/integrations/invoices/:id          the invoice's provider link, if any
 *   POST   /api/integrations/invoices/:id/push     { provider } create it in the provider
 *   POST   /api/integrations/invoices/:id/sync     check its status now
 * Webhooks (mounted before the JSON parser and the session gate, in server/index.ts):
 *   POST /api/integrations/stripe/webhook               Stripe Connect events (signature checked)
 *   POST /api/integrations/paddle/webhook/:connectionId Paddle notifications (signature checked)
 */
import { Router, type Request, type Response } from 'express';
import Stripe from 'stripe';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { pseudonym } from '../auth/secretBox.ts';
import { getInvoice } from '../invoices/store.ts';
import { logger } from '../lib/logger.ts';
import {
  applyRemoteStatus,
  connectionById,
  connectionByStripeAccount,
  deleteConnection,
  firstTime,
  getConnection,
  linkByRemote,
  linkFor,
  openLinks,
  saveConnection,
  saveLink,
  type Provider,
} from '../integrations/store.ts';
import { PROVIDERS, ProviderError, checkPaddleKey, paddleEventStatus, paddleMode, stripeEventStatus, stripePlatform, verifyPaddleSignature, type ProviderApi } from '../integrations/providers.ts';

const router = Router();
let apis: Record<Provider, ProviderApi> = PROVIDERS;
/** Tests: fake provider calls. */
export function setProviderApisForTest(next: Record<Provider, ProviderApi> | null): void {
  apis = next ?? PROVIDERS;
}

const publicBase = (req: Request) => (process.env.PUBLIC_URL?.trim() || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const stateFor = (userId: string, exp: number) => `${userId}.${exp}.${pseudonym('stripe-connect', `${userId}.${exp}`)}`;
function checkState(state: unknown): string | null {
  if (typeof state !== 'string') return null;
  const [userId, exp, sig] = state.split('.');
  if (!userId || !exp || !sig || Number(exp) < Date.now()) return null;
  return stateFor(userId, Number(exp)) === state ? userId : null;
}
function fail(res: Response, err: unknown) {
  if (err instanceof ProviderError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const msg = err instanceof Error ? err.message : 'Provider error';
  logger.warn('integration_error', { err: msg.slice(0, 200) });
  res.status(502).json({ error: 'The payment provider didn’t accept that. Try again.' });
}

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});
const uid = (req: unknown) => (req as { scopeUserId: string }).scopeUserId;

router.get('/', async (req, res) => {
  const db = await getDb();
  let stripeAvailable = false;
  let stripeMode: 'test' | 'live' | null = null;
  try {
    const p = stripePlatform();
    stripeAvailable = Boolean(p.connectClientId);
    stripeMode = p.live ? 'live' : 'test';
  } catch {
    /* not configured */
  }
  const s = getConnection(db, uid(req), 'stripe');
  const p = getConnection(db, uid(req), 'paddle');
  res.json({
    stripe: { available: stripeAvailable, mode: stripeMode, connected: Boolean(s), accountId: s?.accountRef ?? null },
    paddle: { connected: Boolean(p), mode: p?.mode ?? null, webhookUrl: p ? `${publicBase(req)}/api/integrations/paddle/webhook/${p.id}` : null },
  });
});

router.get('/stripe/connect', async (req, res) => {
  try {
    const p = stripePlatform();
    if (!p.connectClientId) throw new ProviderError(503, 'Stripe Connect isn’t set up on this server (STRIPE_CONNECT_CLIENT_ID).');
    const state = stateFor(uid(req), Date.now() + 15 * 60 * 1000);
    const url = `https://connect.stripe.com/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: p.connectClientId, scope: 'read_write', state, redirect_uri: `${publicBase(req)}/api/integrations/stripe/callback` })}`;
    res.json({ url });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/stripe/callback', async (req, res) => {
  const back = '/settings?tab=business&payments=';
  const userId = checkState(req.query.state);
  if (!userId || userId !== uid(req) || typeof req.query.code !== 'string') {
    res.redirect(`${back}stripe_error`);
    return;
  }
  try {
    const p = stripePlatform();
    const token = await p.client.oauth.token({ grant_type: 'authorization_code', code: req.query.code });
    if (!token.stripe_user_id) throw new Error('no account');
    saveConnection(await getDb(), userId, 'stripe', token.stripe_user_id, p.live ? 'live' : 'test');
    res.redirect(`${back}stripe_connected`);
  } catch (err) {
    logger.warn('stripe_connect_failed', { err: String(err).slice(0, 200) });
    res.redirect(`${back}stripe_error`);
  }
});

router.delete('/stripe', async (req, res) => {
  const db = await getDb();
  const c = getConnection(db, uid(req), 'stripe');
  if (!c) {
    res.status(404).json({ error: 'Stripe isn’t connected.' });
    return;
  }
  try {
    const p = stripePlatform();
    if (p.connectClientId) await p.client.oauth.deauthorize({ client_id: p.connectClientId, stripe_user_id: c.accountRef }).catch(() => undefined);
  } catch {
    /* still remove it here */
  }
  deleteConnection(db, uid(req), 'stripe');
  res.json({ ok: true });
});

router.put('/paddle', async (req, res) => {
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  const webhookSecret = typeof req.body?.webhookSecret === 'string' ? req.body.webhookSecret.trim() : '';
  const mode = paddleMode(apiKey);
  if (!mode) {
    res.status(400).json({ error: 'Use a Paddle sandbox API key (pdl_sdbx_…). Live keys aren’t enabled yet.' });
    return;
  }
  if (!webhookSecret) {
    res.status(400).json({ error: 'Add the notification secret from Paddle so payments can be tracked.' });
    return;
  }
  try {
    await checkPaddleKey(apiKey, mode);
  } catch (err) {
    fail(res, err);
    return;
  }
  const c = saveConnection(await getDb(), uid(req), 'paddle', 'paddle', mode, { apiKey, webhookSecret });
  res.json({ ok: true, webhookUrl: `${publicBase(req)}/api/integrations/paddle/webhook/${c.id}` });
});

router.delete('/paddle', async (req, res) => {
  res.status(deleteConnection(await getDb(), uid(req), 'paddle') ? 200 : 404).json({ ok: true });
});

router.get('/invoices/:id', async (req, res) => {
  res.json({ link: linkFor(await getDb(), uid(req), req.params.id) });
});

router.post('/invoices/:id/push', async (req, res) => {
  const provider = req.body?.provider;
  if (provider !== 'stripe' && provider !== 'paddle') {
    res.status(400).json({ error: 'provider must be stripe or paddle' });
    return;
  }
  const db = await getDb();
  const today = aucklandToday();
  const inv = getInvoice(db, uid(req), req.params.id, today);
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  if (inv.storedStatus !== 'sent' || inv.balanceNzd <= 0.004) {
    res.status(409).json({ error: 'Send the invoice first; only an invoice with money owing can go to a provider.' });
    return;
  }
  if (linkFor(db, uid(req), inv.id)) {
    res.status(409).json({ error: 'This invoice is already in a payment provider.' });
    return;
  }
  const conn = getConnection(db, uid(req), provider);
  if (!conn) {
    res.status(409).json({ error: `Connect ${provider === 'stripe' ? 'Stripe' : 'Paddle'} first (Settings → Business).` });
    return;
  }
  try {
    const remote = await apis[provider].createInvoice(conn, inv);
    saveLink(db, uid(req), { invoiceId: inv.id, provider, providerInvoiceId: remote.providerInvoiceId, paymentUrl: remote.paymentUrl, status: 'open' });
    res.json({ link: linkFor(db, uid(req), inv.id) });
  } catch (err) {
    fail(res, err);
  }
});

/** Check one linked invoice with its provider and apply what it says. */
export async function syncLink(userId: string, invoiceId: string): Promise<boolean> {
  const db = await getDb();
  const link = linkFor(db, userId, invoiceId);
  if (!link) return false;
  const conn = getConnection(db, userId, link.provider);
  if (!conn) return false;
  const remote = await apis[link.provider].fetchStatus(conn, link.providerInvoiceId);
  const today = aucklandToday();
  return applyRemoteStatus(db, userId, invoiceId, remote.status, remote.paidOn ?? today, today).changed;
}

router.post('/invoices/:id/sync', async (req, res) => {
  try {
    const changed = await syncLink(uid(req), req.params.id);
    res.json({ changed, link: linkFor(await getDb(), uid(req), req.params.id) });
  } catch (err) {
    fail(res, err);
  }
});

// --- Webhooks ------------------------------------------------------------------------------

export async function stripeConnectWebhook(req: Request, res: Response): Promise<void> {
  let p;
  try {
    p = stripePlatform();
  } catch {
    res.status(503).json({ error: 'Stripe not set up' });
    return;
  }
  if (!p.webhookSecret) {
    res.status(503).json({ error: 'Stripe Connect webhook secret not set' });
    return;
  }
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(req.body, String(req.headers['stripe-signature'] ?? ''), p.webhookSecret);
  } catch {
    res.status(400).json({ error: 'Bad signature' });
    return;
  }
  if (event.livemode !== p.live || !event.account) {
    res.json({ ignored: true });
    return;
  }
  const db = await getDb();
  const conn = connectionByStripeAccount(db, event.account);
  const parsed = stripeEventStatus(event as unknown as Parameters<typeof stripeEventStatus>[0]);
  const link = parsed ? linkByRemote(db, 'stripe', parsed.invoiceId) : null;
  // Only an account connected here, for an invoice created here, by the same user.
  if (!conn || !parsed || !link || link.userId !== conn.userId) {
    res.json({ ignored: true });
    return;
  }
  if (!firstTime(db, 'stripe', event.id)) {
    res.json({ duplicate: true });
    return;
  }
  const today = aucklandToday();
  applyRemoteStatus(db, conn.userId, link.invoiceId, parsed.status, parsed.paidOn ?? today, today);
  res.json({ ok: true });
}

export async function paddleWebhook(req: Request, res: Response): Promise<void> {
  const db = await getDb();
  const conn = connectionById(db, String(req.params.connectionId ?? ''));
  if (!conn || conn.provider !== 'paddle' || !conn.webhookSecret) {
    res.status(404).json({ error: 'Unknown connection' });
    return;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!verifyPaddleSignature(req.headers['paddle-signature'] as string | undefined, raw, conn.webhookSecret)) {
    res.status(400).json({ error: 'Bad signature' });
    return;
  }
  let event: { event_id?: string; event_type?: string; data?: { id?: string; status?: string; updated_at?: string } };
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Bad JSON' });
    return;
  }
  const parsed = paddleEventStatus(event);
  const link = parsed ? linkByRemote(db, 'paddle', parsed.invoiceId) : null;
  if (!parsed || !link || link.userId !== conn.userId || !event.event_id) {
    res.json({ ignored: true });
    return;
  }
  if (!firstTime(db, 'paddle', event.event_id)) {
    res.json({ duplicate: true });
    return;
  }
  const today = aucklandToday();
  applyRemoteStatus(db, conn.userId, link.invoiceId, parsed.status, parsed.paidOn ?? today, today);
  res.json({ ok: true });
}

/** Hourly catch-up for missed webhooks. Returns a stop function. */
export function startProviderCatchUp(): () => void {
  if (process.env.NODE_ENV === 'test') return () => {};
  const tick = async () => {
    const db = await getDb();
    for (const l of openLinks(db)) {
      try {
        await syncLink(l.userId, l.invoiceId);
      } catch (err) {
        logger.warn('provider_catchup_failed', { invoiceId: l.invoiceId, err: String(err).slice(0, 200) });
      }
    }
  };
  const timer = setInterval(() => void tick(), 60 * 60 * 1000);
  return () => clearInterval(timer);
}

export default router;
