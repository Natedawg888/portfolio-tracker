/**
 * Create-account Akahu policy (the same POST /api/auth/register the hosted app uses).
 * Run: npm run test:onboarding
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import {
  AKAHU_SETUP_EMAIL,
  akahuOnboardingRequiredForEmail,
  initialPreferencesJsonForNewUser,
  parseOnboardingFromPreferencesJson,
  preferencesWithAkahuSkippedUnlessRequired,
} from '../../src/lib/onboardingPrefs.ts';

const dbPath = path.join(os.tmpdir(), `pt-akahu-onboarding-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

type OnboardingBody = {
  onboardingComplete?: boolean;
  onboarding?: {
    assetClassesDone?: boolean;
    budgetCategoriesDone?: boolean;
    akahuStepDone?: boolean;
  };
};

function assertSkippedAtCreation(label: string, body: { user?: OnboardingBody }) {
  const flags = body.user?.onboarding;
  assert(flags?.akahuStepDone === true, `${label}: create-account must already have Akahu skipped`);
  assert(flags?.assetClassesDone === false, `${label}: asset step still required`);
  assert(flags?.budgetCategoriesDone === false, `${label}: budget step still required`);
  assert(body.user?.onboardingComplete === false, `${label}: signup is not finished yet`);
}

function assertAkahuStillOffered(label: string, body: { user?: OnboardingBody }) {
  const flags = body.user?.onboarding;
  assert(flags?.akahuStepDone === false, `${label}: Nathan's create-account must still offer Akahu`);
  assert(flags?.assetClassesDone === false, `${label}: asset step still required`);
  assert(flags?.budgetCategoriesDone === false, `${label}: budget step still required`);
  assert(body.user?.onboardingComplete === false, `${label}: Nathan still has setup left`);
}

const { default: authRouter } = await import('../routes/auth.ts');
const { default: settingsRouter } = await import('../routes/settings.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/settings', attachUser, settingsRouter);

const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function post(
  pathname: string,
  body: unknown,
  cookie?: string,
): Promise<{ status: number; json: Record<string, unknown>; cookie?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${pathname}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  const sid = setCookie?.split(';')[0];
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json, cookie: sid };
}

async function put(
  pathname: string,
  body: unknown,
  cookie: string,
): Promise<{ status: number; json: OnboardingBody & Record<string, unknown> }> {
  const res = await fetch(`${base}${pathname}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as OnboardingBody & Record<string, unknown>;
  return { status: res.status, json };
}

let passed = 0;

try {
  assert(akahuOnboardingRequiredForEmail('  MccormickNathan09@Gmail.com ') === true, 'Nathan email match is trimmed + case-insensitive');
  assert(akahuOnboardingRequiredForEmail('someone@example.com') === false, 'other emails do not require Akahu');
  assert(akahuOnboardingRequiredForEmail('mccormick.nathan09@gmail.com') === false, 'lookalike emails are not Nathan');
  assert(AKAHU_SETUP_EMAIL === 'mccormicknathan09@gmail.com', 'canonical email');

  const otherPrefs = parseOnboardingFromPreferencesJson(initialPreferencesJsonForNewUser('new.user@example.com'));
  assert(otherPrefs.flags?.akahuStepDone === true, 'initial prefs skip Akahu for a new non-Nathan account');
  assert(otherPrefs.complete === false, 'initial prefs still require assets and budgets');
  const nathanPrefs = parseOnboardingFromPreferencesJson(
    initialPreferencesJsonForNewUser('  MccormickNathan09@Gmail.com '),
  );
  assert(nathanPrefs.flags?.akahuStepDone === false, 'initial prefs still offer Akahu for Nathan');

  const legacy = JSON.stringify({ assetClasses: { stocks: true } });
  const legacyApplied = preferencesWithAkahuSkippedUnlessRequired(legacy, 'other@example.com');
  assert(legacyApplied.changed === false, 'legacy accounts without onboarding stay untouched');

  const stuck = preferencesWithAkahuSkippedUnlessRequired(
    JSON.stringify({
      onboarding: { assetClassesDone: true, budgetCategoriesDone: true, akahuStepDone: false },
    }),
    'other@example.com',
  );
  assert(stuck.changed === true, 'in-progress non-Nathan account records the skip');
  const stuckParsed = parseOnboardingFromPreferencesJson(stuck.json);
  assert(stuckParsed.complete === true, 'skipped Akahu plus finished required steps opens the app');
  assert(stuckParsed.flags?.assetClassesDone === true && stuckParsed.flags?.budgetCategoriesDone === true, 'other flags preserved');

  const nathanStuck = preferencesWithAkahuSkippedUnlessRequired(
    JSON.stringify({
      onboarding: { assetClassesDone: true, budgetCategoriesDone: true, akahuStepDone: false },
    }),
    AKAHU_SETUP_EMAIL,
  );
  assert(nathanStuck.changed === false, 'Nathan is not auto-skipped');
  assert(parseOnboardingFromPreferencesJson(nathanStuck.json).complete === false, 'Nathan still owes the Akahu step');
  passed += 1;

  const password = 'SignupTest1';
  const other = await post('/api/auth/register', {
    email: 'new.user@example.com',
    password,
    firstName: 'New',
    lastName: 'User',
  });
  assert(other.status === 201, `other register status ${other.status} ${JSON.stringify(other.json)}`);
  assertSkippedAtCreation('other register', other.json as { user?: OnboardingBody });
  assert(typeof other.cookie === 'string' && other.cookie.startsWith('pt_sid='), 'register sets session cookie');

  const nathan = await post('/api/auth/register', {
    email: '  MccormickNathan09@Gmail.com ',
    password,
    firstName: 'Nathan',
    lastName: 'McCormick',
  });
  assert(nathan.status === 201, `Nathan register status ${nathan.status} ${JSON.stringify(nathan.json)}`);
  assertAkahuStillOffered('Nathan register', nathan.json as { user?: OnboardingBody });
  const nathanUser = nathan.json.user as { email?: string } | undefined;
  assert(nathanUser?.email === AKAHU_SETUP_EMAIL, `stored email ${nathanUser?.email}`);

  const lookalike = await post('/api/auth/register', {
    email: 'mccormick.nathan09@gmail.com',
    password,
    firstName: 'Not',
    lastName: 'Nathan',
  });
  assert(lookalike.status === 201, `lookalike register status ${lookalike.status}`);
  assertSkippedAtCreation('lookalike register', lookalike.json as { user?: OnboardingBody });
  passed += 1;

  const otherDone = await put(
    '/api/settings/onboarding',
    { assetClassesDone: true, budgetCategoriesDone: true },
    other.cookie!,
  );
  assert(otherDone.status === 200, `other onboarding status ${otherDone.status}`);
  assert(otherDone.json.onboarding?.akahuStepDone === true, 'finishing required steps keeps Akahu skipped');
  assert(otherDone.json.onboardingComplete === true, 'non-Nathan signup can finish without the Akahu step');

  const nathanAssets = await put(
    '/api/settings/onboarding',
    { assetClassesDone: true, budgetCategoriesDone: true },
    nathan.cookie!,
  );
  assert(nathanAssets.status === 200, `Nathan onboarding status ${nathanAssets.status}`);
  assert(nathanAssets.json.onboarding?.akahuStepDone === false, 'Nathan is still asked to connect Akahu');
  assert(nathanAssets.json.onboardingComplete === false, 'Nathan cannot pass setup while Akahu is still open');
  passed += 1;

  // Usage mode (KAN-124): new accounts haven't chosen; Business only skips the personal steps.
  const biz = await post('/api/auth/register', { email: 'books@example.com', password, firstName: 'Book', lastName: 'Keeper' });
  assert(biz.status === 201 && biz.cookie, 'business user registered');
  const bizUser = biz.json.user as { usageMode?: string; usageModeChosen?: boolean };
  assert(bizUser.usageMode === 'personal' && bizUser.usageModeChosen === false, 'a new account starts as personal, not yet chosen');
  assert((await put('/api/settings/usage-mode', { mode: 'accountant' }, biz.cookie!)).status === 400, 'an unknown mode is refused');
  assert((await put('/api/settings/usage-mode', {}, biz.cookie!)).status === 400, 'a mode is required');
  const noAuth = await fetch(`${base}/api/settings/usage-mode`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'business' }) });
  assert(noAuth.status === 401, 'signed out is refused');
  const chosen = await put('/api/settings/usage-mode', { mode: 'business' }, biz.cookie!);
  assert(chosen.status === 200 && chosen.json.usageMode === 'business', 'business saved');
  assert(chosen.json.onboardingComplete === true, 'business only finishes signup without the personal steps');
  assert(chosen.json.onboarding?.assetClassesDone === true && chosen.json.onboarding?.budgetCategoriesDone === true, 'asset and budget steps marked not needed');
  // Signing in returns the same user object the app keeps (this harness has no attachUser for /me).
  const signIn = await post('/api/auth/login', { email: 'books@example.com', password });
  const signedIn = signIn.json.user as { usageMode?: string; usageModeChosen?: boolean } | undefined;
  assert(signedIn?.usageMode === 'business' && signedIn?.usageModeChosen === true, `the signed-in user carries the mode (${JSON.stringify(signIn.json)})`);

  const both = await post('/api/auth/register', { email: 'both@example.com', password, firstName: 'Both', lastName: 'Ways' });
  const bothChosen = await put('/api/settings/usage-mode', { mode: 'both' }, both.cookie!);
  assert(bothChosen.json.usageMode === 'both' && bothChosen.json.onboardingComplete === false, 'both keeps the personal steps');
  assert(bothChosen.json.onboarding?.budgetCategoriesDone === false, 'both still asks for budget categories');

  // Changing the mode later (Settings) after signup: flags stay done, the mode changes.
  const back = await put('/api/settings/usage-mode', { mode: 'personal' }, biz.cookie!);
  assert(back.json.usageMode === 'personal' && back.json.onboardingComplete === true, 'switching back to personal keeps signup finished');
  passed += 1;

  console.log(`OK: register Akahu onboarding (${passed} groups)`);
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
