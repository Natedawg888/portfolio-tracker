/**
 * Household Working for Families estimate API (KAN-79): two earners and two children give
 * IRD's figures for the selected tax year, a year without loaded rates gives a dash, partners
 * must share their pay, viewers can't see it, validation, the activity log has no details, and
 * leaving removes a partner.
 * Run: npm run test:household
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-hh-family-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'f'.repeat(64);
process.env.PLAN_PLUS_EMAILS = 'olive@example.com';
delete process.env.RESEND_API_KEY;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: householdRouter } = await import('../routes/household.ts');

const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const [id, first] of [['olive', 'Olive'], ['adam', 'Adam'], ['vic', 'Vic'], ['tai', 'Tai']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', first, 'Smith', now, now]);
}
const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/household', householdRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/household`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
const pay = (amount: number) => ({
  inputs: {
    amount, frequency: 'year', hoursPerWeek: 40, employment: 'primary', secondaryTotalAnnualIncome: 0, otherAnnualGross: 0,
    kiwiSaverOptIn: true, kiwiSaverEmployeeRatePct: 3.5, kiwiSaverEmployerRatePct: 3.5, salarySacrifice: false, studentLoan: false, ietc: true,
  },
  includePaySources: false,
});

try {
  const C = Object.fromEntries(await Promise.all(['olive', 'adam', 'vic', 'tai'].map(async (u) => [u, `${SESSION_COOKIE}=${(await createSession(u)).rawToken}`])));
  await call('POST', '/', C.olive, { name: 'Home' });
  for (const [who, role] of [['adam', 'adult'], ['vic', 'viewer'], ['tai', 'viewer']]) {
    const inv = await call('POST', '/invites', C.olive, { email: `${who}@example.com`, role });
    await call('POST', '/invites/accept', C[who], { token: inv.json.invite.link.split('#token=')[1] });
  }

  let r = await call('GET', '/family', C.olive);
  assert(r.status === 200 && r.json.estimate === null && r.json.missing.includes('parents'), 'starts by asking who the parents are');
  assert((await call('GET', '/family', C.vic)).status === 403, 'viewers can’t see the estimate');
  assert((await call('PUT', '/family', C.vic, { partnerIds: [] })).status === 403, 'viewers can’t change family details');

  // Validation.
  const kids = [{ birthMonth: '2016-05' }, { birthMonth: '2019-11', memberId: 'tai' }];
  assert((await call('PUT', '/family', C.olive, { partnerIds: ['olive', 'adam', 'vic'], children: kids })).status === 400, 'at most two parents');
  assert((await call('PUT', '/family', C.olive, { partnerIds: ['olive', 'nobody'], children: kids })).status === 400, 'parents must be members');
  assert((await call('PUT', '/family', C.olive, { partnerIds: ['olive'], children: [{ birthMonth: '2031-01' }] })).status === 400, 'no future births');
  assert((await call('PUT', '/family', C.olive, { partnerIds: ['olive'], children: [{ birthMonth: 'June' }] })).status === 400, 'birth month format');
  assert((await call('PUT', '/family', C.olive, { partnerIds: ['olive', 'adam'], children: [{ birthMonth: '2016-05', memberId: 'adam' }] })).status === 400, 'a parent can’t also be a child');

  r = await call('PUT', '/family', C.adam, { partnerIds: ['olive', 'adam'], children: kids, mainBenefit: false });
  assert(r.status === 200 && r.json.partners.length === 2 && r.json.children[1].memberName === 'Tai Smith', 'an adult saves the family');
  assert(r.json.estimate === null && r.json.missing.includes('Olive Smith and Adam Smith') && r.json.missing.includes('share their pay'), 'needs both partners’ pay');

  await call('PUT', '/paye/mine', C.olive, pay(55000));
  r = await call('GET', '/family', C.olive);
  assert(r.json.estimate === null && r.json.missing.startsWith('Adam Smith'), 'still needs Adam’s pay');

  // Two earners ($55,000 + $35,000) and two children at school, 2026/27: IRD figures.
  await call('PUT', '/paye/mine', C.adam, pay(35000));
  r = await call('GET', '/family', C.olive);
  const e = r.json.estimate;
  assert(r.json.familyIncomeNzd === 90000, 'family income is the partners’ gross');
  assert(e.dependentChildren === 2 && e.annual.ftc === 1972.5 && e.weekly.ftc === 37 && e.weekly.iwtc === 147 && e.weekly.mftc === 0 && e.weekly.bestStart === 0, `estimate ${JSON.stringify(e.weekly)}`);
  assert(e.notes.some((n: string) => n.includes('ME tax code')), 'notes that IETC and WFF don’t mix');
  assert(e.notes.some((n: string) => n.includes('$147 a week')), 'notes the temporary IWTC');
  assert(r.json.rates.checkedOn === '2026-10-16' && r.json.rates.sources.some((s: Json) => s.url.includes('ir271-2027')), 'sources and checked date');

  // Tax-year switching: 2025/26 has no Working for Families rates loaded.
  r = await call('GET', '/family?year=2025', C.olive);
  assert(r.json.taxYear === 2025 && r.json.rates === null && r.json.estimate === null && r.json.missing.includes('aren’t loaded'), '2025/26 shows a dash');

  // A sole parent on a benefit: FTC only.
  r = await call('PUT', '/family', C.olive, { partnerIds: ['olive'], children: kids, mainBenefit: true });
  assert(r.json.estimate.annual.iwtc === 0 && r.json.estimate.annual.ftc > 0 && r.json.familyIncomeNzd === 55000, 'sole parent, main benefit: FTC only');

  // Activity log: nothing personal.
  const acts = (await call('GET', '/', C.olive)).json.household.activity.map((a: Json) => `${a.action} ${a.detail}`);
  assert(acts.includes('updated the family details for tax credits ') && !acts.some((t: string) => /\d/.test(t)), 'no dates or amounts in the log');

  // Leaving: a linked child is unlinked; a partner is removed.
  await call('PUT', '/family', C.olive, { partnerIds: ['olive', 'adam'], children: kids });
  await call('POST', '/leave', C.tai);
  await call('POST', '/leave', C.adam);
  r = await call('GET', '/family', C.olive);
  assert(r.json.partners.length === 1 && r.json.partners[0].memberId === 'olive', 'Adam is no longer a partner');
  assert(r.json.children.length === 2 && r.json.children[1].memberId === null, 'Tai’s entry stays, unlinked');

  await call('DELETE', '/', C.olive);
  assert(queryAll(db, `SELECT * FROM household_family`).length === 0, 'family details go with the household');
  console.log('household family tax credit tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
