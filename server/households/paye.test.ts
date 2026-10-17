/**
 * Household PAYE API (KAN-79): opting in, per-member figures matching the single-person PAYE
 * engine, privacy (members who haven't opted in never appear; viewers see totals only),
 * tax-year switching, saved pay sources, what-ifs, the budget feed, the activity log holding
 * no amounts, plan gating, and figures going when a member leaves or the household is deleted.
 * Run: npm run test:household
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-hh-paye-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'e'.repeat(64);
process.env.PLAN_PLUS_EMAILS = 'olive@example.com';
delete process.env.RESEND_API_KEY;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { calculatePaye } = await import('../../src/lib/payeCalc.ts');
const { parsePaySourceBody } = await import('../paySources/model.ts');
const { createPaySource } = await import('../paySources/store.ts');
const { default: householdRouter } = await import('../routes/household.ts');

const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const [id, first] of [['olive', 'Olive'], ['adam', 'Adam'], ['vic', 'Vic'], ['ruth', 'Ruth'], ['sam', 'Sam']]) {
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

const salaryOlive = {
  amount: 85000, frequency: 'year', hoursPerWeek: 40, employment: 'primary', secondaryTotalAnnualIncome: 0, otherAnnualGross: 0,
  kiwiSaverOptIn: true, kiwiSaverEmployeeRatePct: 4, kiwiSaverEmployerRatePct: 3.5, salarySacrifice: false, studentLoan: false, ietc: true,
} as const;
const wagesAdam = {
  amount: 28, frequency: 'hour', hoursPerWeek: 40, employment: 'primary', secondaryTotalAnnualIncome: 0, otherAnnualGross: 0,
  kiwiSaverOptIn: true, kiwiSaverEmployeeRatePct: 3.5, kiwiSaverEmployerRatePct: 3.5, salarySacrifice: false, studentLoan: true, ietc: true,
} as const;
const single = (inputs: Json, taxYear?: number) => {
  const b = calculatePaye({ ...(inputs as any), taxYear, payrollGivingAnnual: 0 });
  return { gross: b.annualGross, net: b.takeHome, acc: b.acc, ks: b.kiwiSaverEmployee, sl: b.studentLoan };
};
const r2 = (n: number) => Math.round(n * 100) / 100;

try {
  const C = Object.fromEntries(await Promise.all(['olive', 'adam', 'vic', 'ruth', 'sam'].map(async (u) => [u, `${SESSION_COOKIE}=${(await createSession(u)).rawToken}`])));
  await call('POST', '/', C.olive, { name: 'Home' });
  for (const [who, role] of [['adam', 'adult'], ['vic', 'viewer'], ['ruth', 'adult']]) {
    const inv = await call('POST', '/invites', C.olive, { email: `${who}@example.com`, role });
    await call('POST', '/invites/accept', C[who], { token: inv.json.invite.link.split('#token=')[1] });
  }

  // Nothing shared yet.
  let r = await call('GET', '/paye', C.olive);
  assert(r.status === 200 && r.json.includedCount === 0 && r.json.members.length === 0 && r.json.totals.netNzd === 0, 'empty to start');
  assert(r.json.taxYear === 2026 && r.json.years.map((y: Json) => y.startYear).join() === '2026,2025,2024', 'years offered');
  assert((await call('GET', '/paye', C.sam)).status === 404, 'a stranger sees nothing');

  // Validation.
  assert((await call('PUT', '/paye/mine', C.olive, { inputs: { ...salaryOlive, amount: 0 } })).status === 400, 'pay is required');
  assert((await call('PUT', '/paye/mine', C.olive, { inputs: null, includePaySources: false })).status === 400, 'something must be shared');
  assert((await call('PUT', '/paye/mine', C.olive, { inputs: { ...salaryOlive, frequency: 'daily' } })).status === 400, 'frequency checked');

  // Two members opt in; Vic (viewer) and Ruth (adult) don't.
  assert((await call('PUT', '/paye/mine', C.olive, { inputs: salaryOlive })).status === 200, 'Olive opts in');
  assert((await call('PUT', '/paye/mine', C.adam, { inputs: wagesAdam })).status === 200, 'Adam opts in');

  // Each member matches the single-person PAYE engine; totals are the sum.
  r = await call('GET', '/paye', C.ruth);
  assert(r.json.canSeeMembers && r.json.members.length === 2 && r.json.includedCount === 2, 'an adult sees both opted-in members');
  const o = r.json.members.find((x: Json) => x.memberId === 'olive');
  const a = r.json.members.find((x: Json) => x.memberId === 'adam');
  const so = single(salaryOlive);
  const sa = single(wagesAdam);
  assert(o.totals.grossNzd === so.gross && o.totals.netNzd === so.net && o.totals.accNzd === so.acc && o.totals.kiwiSaverNzd === so.ks, 'Olive matches the PAYE calculator');
  assert(a.totals.grossNzd === sa.gross && a.totals.netNzd === sa.net && a.totals.studentLoanNzd === sa.sl && sa.sl > 0, 'Adam matches, student loan included');
  assert(o.lines[0].taxCode === 'M' && a.lines[0].taxCode === 'ME SL', 'tax codes');
  const p = o.totals;
  assert(r2(p.grossNzd - p.payeNzd - p.accNzd - p.kiwiSaverNzd - p.studentLoanNzd) === p.netNzd, 'columns add up to net');
  assert(r.json.totals.netNzd === r2(so.net + sa.net) && r.json.totals.grossNzd === r2(so.gross + sa.gross), 'household totals');
  assert(r.json.netPerPeriod.month === r2((so.net + sa.net) / 12) && r.json.netPerPeriod.week === r2((so.net + sa.net) / 52), 'net per period');
  assert(!r.json.members.some((x: Json) => x.memberId === 'vic' || x.memberId === 'ruth'), 'members who haven’t opted in never appear');
  assert(!JSON.stringify(r.json.members).includes('Ruth') && !JSON.stringify(r.json.members).includes('Vic'), 'not even by name');
  assert(r.json.mine.optedIn === false && r.json.mine.inputs === null, 'Ruth sees only her own opt-in state');

  // Viewers: totals only.
  r = await call('GET', '/paye', C.vic);
  assert(r.status === 200 && !r.json.canSeeMembers && r.json.members.length === 0, 'a viewer gets no per-member figures');
  assert(r.json.totals.netNzd === r2(so.net + sa.net), 'a viewer sees household totals');
  assert(!JSON.stringify(r.json).includes('85000') && !JSON.stringify(r.json).includes('Olive'), 'nothing about individual members leaks to a viewer');
  assert((await call('POST', '/paye/what-if', C.vic, { memberId: 'adam', change: { kind: 'stop' } })).status === 403, 'viewers can’t run what-ifs');
  assert((await call('PUT', '/paye/settings', C.vic, { feedBudget: true })).status === 403, 'viewers can’t turn on the budget feed');

  // Your own inputs come back to you only.
  r = await call('GET', '/paye', C.adam);
  assert(r.json.mine.optedIn && r.json.mine.inputs.amount === 28 && r.json.mine.inputs.frequency === 'hour', 'Adam sees his own inputs');
  assert(!JSON.stringify(r.json.members).includes('"amount"'), 'other members’ raw inputs are never sent');

  // Tax-year switching.
  r = await call('GET', '/paye?year=2025', C.olive);
  const o25 = r.json.members.find((x: Json) => x.memberId === 'olive').totals;
  const so25 = single(salaryOlive, 2025);
  assert(r.json.taxYear === 2025 && o25.netNzd === so25.net && o25.accNzd === so25.acc, '2025/26 matches the calculator for that year');
  assert(o25.accNzd < o.totals.accNzd && o25.netNzd > o.totals.netNzd, '2025/26 ACC is lower, so take-home is higher');
  assert((await call('GET', '/paye?year=1999', C.olive)).json.taxYear === 2026, 'an unknown year shows the current one');
  assert((await call('GET', '/paye?year=2025', C.vic)).json.totals.netNzd === r.json.totals.netNzd, 'viewers switch years too');

  // Saved pay sources.
  const draft = parsePaySourceBody({ name: 'Kiwifruit', inputs: { payType: 'piece', unit: 'bin', piece: { ratePerUnit: 2, unitsPerWeek: 300, hoursPerWeek: 40, holidayPayWithWages: true }, paye: { employment: 'secondary', secondaryTotalAnnualIncome: 110000, kiwiSaverOptIn: false } } });
  assert(draft.ok, 'piece draft');
  if (draft.ok) createPaySource(db, 'adam', draft.value);
  const catchDraft = parsePaySourceBody({ name: 'Boat', inputs: { payType: 'share_of_catch', shareOfCatch: { catchValue: 1000, per: 'week', sharePct: 10, expensesPerWeek: 20 } } });
  if (catchDraft.ok) createPaySource(db, 'adam', catchDraft.value);
  r = await call('PUT', '/paye/mine', C.adam, { inputs: wagesAdam, includePaySources: true });
  let lines = r.json.members.find((x: Json) => x.memberId === 'adam').lines;
  assert(lines.length === 3 && lines[1].kind === 'piece' && lines[1].onPaye && lines[1].payeNzd > 0, 'piece rate goes through PAYE');
  assert(lines[2].kind === 'share_of_catch' && !lines[2].onPaye && lines[2].grossNzd === 5200 && lines[2].netNzd === 4160 && lines[2].payeNzd === 0, 'share of catch: gross and received only');
  const piece26 = lines[1].grossNzd;
  lines = (await call('GET', '/paye?year=2025', C.adam)).json.members.find((x: Json) => x.memberId === 'adam').lines;
  assert(lines[1].grossNzd < piece26, 'piece rate is topped up to that year’s minimum wage');
  assert((await call('GET', '/paye', C.adam)).json.mine.paySourceCount === 2, 'pay source count');

  // What-ifs.
  const tot = (await call('GET', '/paye', C.olive)).json.totals;
  const adamNow = (await call('GET', '/paye', C.olive)).json.members.find((x: Json) => x.memberId === 'adam').totals;
  r = await call('POST', '/paye/what-if', C.ruth, { memberId: 'adam', taxYear: 2026, change: { kind: 'stop' } });
  assert(r.status === 200 && r.json.after.netNzd === r2(tot.netNzd - adamNow.netNzd) && r.json.memberAfter.netNzd === 0, 'Adam stops work');
  assert(r.json.netChangePerPeriod.year === r2(-adamNow.netNzd), 'change per year');
  r = await call('POST', '/paye/what-if', C.olive, { memberId: 'adam', change: { kind: 'hours', hoursPerWeek: 20 } });
  const half = single({ ...wagesAdam, hoursPerWeek: 20 });
  assert(r.json.memberAfter.grossNzd === r2(half.gross + piece26 + 5200), `Adam goes to 20 hours (${r.json.memberAfter.grossNzd})`);
  r = await call('POST', '/paye/what-if', C.olive, { memberId: 'olive', change: { kind: 'hours', hoursPerWeek: 32 } });
  assert(r.json.memberAfter.grossNzd === 68000 && r.json.notes[0].includes('scaled'), 'salary scales pro rata with hours');
  r = await call('POST', '/paye/what-if', C.olive, { memberId: 'olive', change: { kind: 'salary', annualNzd: 95000 } });
  assert(r.json.memberAfter.netNzd === single({ ...salaryOlive, amount: 95000 }).net, 'salary change');
  r = await call('POST', '/paye/what-if', C.olive, { memberId: 'olive', change: { kind: 'kiwisaver', ratePct: 8 } });
  assert(r.json.memberAfter.kiwiSaverNzd === 6800 && r.json.after.netNzd < r.json.before.netNzd, 'KiwiSaver 8%');
  assert((await call('POST', '/paye/what-if', C.olive, { memberId: 'olive', taxYear: 2025, change: { kind: 'kiwisaver', ratePct: 3.5 } })).status === 400, '3.5% wasn’t a 2025/26 rate');
  assert((await call('POST', '/paye/what-if', C.olive, { memberId: 'olive', taxYear: 2025, change: { kind: 'kiwisaver', ratePct: 3 } })).status === 200, '3% was');
  assert((await call('POST', '/paye/what-if', C.olive, { memberId: 'ruth', change: { kind: 'stop' } })).status === 404, 'no what-ifs on someone who hasn’t opted in');
  const before = (await call('GET', '/paye', C.olive)).json.totals.netNzd;
  assert(before === tot.netNzd, 'what-ifs change nothing');

  // Budget feed.
  r = await call('PUT', '/paye/settings', C.adam, { feedBudget: true });
  assert(r.status === 200 && r.json.feedBudget, 'an adult turns on the budget feed');
  const d = (await call('GET', '/dashboard', C.vic)).json;
  assert(d.moneyIn && d.moneyIn.monthlyNzd === r2(tot.netNzd / 12) && d.moneyIn.includedCount === 2 && d.moneyIn.plannedNzd === 0, 'dashboard money in');
  await call('PUT', '/paye/settings', C.adam, { feedBudget: false });
  assert((await call('GET', '/dashboard', C.vic)).json.moneyIn === null, 'and off');

  // Activity log: what happened, never amounts.
  const acts = (await call('GET', '/', C.olive)).json.household.activity.map((x: Json) => `${x.actorName}: ${x.action} ${x.detail}`);
  assert(acts.includes('Olive Smith: started sharing their pay ') && acts.includes('Adam Smith: updated the pay they share '), `activity ${acts}`);
  assert(!acts.some((t: string) => /\d/.test(t)), 'no amounts in the activity log');

  // Plan: changes need Plus; opting out never does.
  process.env.PLAN_PLUS_EMAILS = '';
  assert((await call('PUT', '/paye/mine', C.ruth, { inputs: salaryOlive })).status === 402, 'opting in needs Plus');
  assert((await call('PUT', '/paye/settings', C.olive, { feedBudget: true })).status === 402, 'settings need Plus');
  assert((await call('GET', '/paye', C.olive)).json.canEdit === false, 'nothing editable');
  process.env.PLAN_PLUS_EMAILS = 'olive@example.com';

  // Opting out, leaving, and deleting the household remove figures.
  r = await call('DELETE', '/paye/mine', C.olive);
  assert(r.status === 200 && r.json.includedCount === 1 && !r.json.mine.optedIn, 'Olive opts out');
  await call('POST', '/leave', C.adam);
  r = await call('GET', '/paye', C.olive);
  assert(r.json.includedCount === 0 && r.json.totals.netNzd === 0, 'Adam’s figures go when he leaves');
  assert(queryAll(db, `SELECT * FROM household_pay WHERE user_id = 'adam'`).length === 0, 'and his row is deleted');
  await call('PUT', '/paye/mine', C.ruth, { inputs: salaryOlive });
  await call('PUT', '/paye/settings', C.ruth, { feedBudget: true });
  await call('DELETE', '/', C.olive);
  assert(queryAll(db, `SELECT * FROM household_pay`).length === 0 && queryAll(db, `SELECT * FROM household_pay_settings`).length === 0, 'deleting the household removes all pay');
  assert(queryAll(db, `SELECT * FROM pay_sources WHERE user_id = 'adam'`).length === 2, 'saved pay sources stay with their owner');
  console.log('household PAYE tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
