/**
 * Scenario tool (KAN-32): extra savings, a pay rise (as extra take-home), investing monthly and a
 * mortgage rate change, applied to the user's own projection; plus the HTTP route.
 * Run: npm run test:projections
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-scenario-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';

const { projectSeries } = await import('./model.ts');
const { applyScenarioToClasses, applyScenarioToDebts, difference, parseScenario, summarise, NO_SCENARIO } = await import('./scenario.ts');

type Classes = Parameters<typeof applyScenarioToClasses>[0];
const classes: Classes = [
  { key: 'cash', startNzd: 10_000, annualReturnPercent: 0, returnSource: 'default', monthlyAdditionNzd: 1_000, additionSource: 'user_data', additionReason: null },
  { key: 'shares', startNzd: 20_000, annualReturnPercent: 12, returnSource: 'query', monthlyAdditionNzd: null, additionSource: 'default', additionReason: null },
];
const mortgage = { id: 'm', name: 'Home loan', balanceNzd: 300_000, annualRatePercent: 6, interestPeriod: 'year' as const, actualPaymentNzd: 2_000, productKind: 'mortgage' };
const card = { id: 'c', name: 'Visa', balanceNzd: 1_000, annualRatePercent: 20, interestPeriod: 'year' as const, actualPaymentNzd: 100, productKind: 'credit_card' };

function run12(cls: Classes, debts: (typeof mortgage)[]) {
  return projectSeries({
    assetClasses: cls,
    additionGrowthPercentYear: 0,
    asOf: '2026-11-23',
    horizonMonths: 12,
    compoundingAssetsNzd: 30_000,
    bankLiabilitiesNzd: 0,
    propertyMortgageNzd: 0,
    kiwiSaverBalanceNzd: null,
    debts,
    annualReturnPercent: 0,
    annualReturnSource: 'default',
    monthlySavingNzd: 1_000,
    monthlySavingSource: 'user_data',
    monthlySavingReason: null,
    observedSaving: { windowMonths: 3, windowStart: '2026-08', windowEnd: '2026-10', incomeNzd: null, spendingNzd: null, monthsWithActivity: 0, monthlyNzd: null, reason: null, expectedPayMonthlyNzd: null, usedExpectedPay: false },
    kiwiSaverContributionMonthlyNzd: null,
    kiwiSaverContributionReason: null,
  } as Parameters<typeof projectSeries>[0]);
}

const base = summarise(run12(classes, [mortgage, card]));

// Save $200 more a month: +$2,400 of savings over 12 months, same investments.
let s = { ...NO_SCENARIO, extraSavingMonthlyNzd: 200 };
let d = difference(base, summarise(run12(applyScenarioToClasses(classes, s), [mortgage, card])));
eq([d.savingsEndNzd, d.investmentsEndNzd, d.netWorthEndNzd], [2_400, 0, 2_400], 'save $200 more a month');

// Pay rise worked out as extra take-home of $250 a month.
s = { ...NO_SCENARIO, extraIncomeMonthlyNzd: 250 };
d = difference(base, summarise(run12(applyScenarioToClasses(classes, s), [mortgage, card])));
eq(d.savingsEndNzd, 3_000, 'pay rise: $250 a month more saved');

// Invest $500 a month: cash −$6,000, investments +$6,000 plus their growth.
s = { ...NO_SCENARIO, investMonthlyNzd: 500 };
d = difference(base, summarise(run12(applyScenarioToClasses(classes, s), [mortgage, card])));
eq(d.savingsEndNzd, -6_000, 'invest: cash goes down by what moves');
eq(d.investmentsEndNzd > 6_000 && d.investmentsEndNzd < 6_400, true, `invest: shares up by $6,000 plus a year of 12% growth (${d.investmentsEndNzd})`);
eq(d.netWorthEndNzd === Math.round((d.savingsEndNzd + d.investmentsEndNzd) * 100) / 100, true, 'net worth moves by the growth');

// Mortgage rates up 1%: only the mortgage changes; more is owed at the end.
s = { ...NO_SCENARIO, mortgageRateChangePct: 1 };
const debts = applyScenarioToDebts([mortgage, card], s);
eq([debts[0].annualRatePercent, debts[1].annualRatePercent], [7, 20], 'only the mortgage rate moves');
d = difference(base, summarise(run12(classes, debts)));
eq(d.debtEndNzd > 2_900 && d.debtEndNzd < 3_100, true, `about $3,000 more owing after a year at 7% (${d.debtEndNzd})`);
eq(d.netWorthEndNzd, -d.debtEndNzd, 'net worth down by the extra debt');
eq(applyScenarioToDebts([{ ...mortgage, annualRatePercent: 0.5 }], { ...NO_SCENARIO, mortgageRateChangePct: -1 })[0].annualRatePercent, 0, 'never below 0%');

// No change → identical. A missing shares class is added for investing.
eq(applyScenarioToClasses(classes, NO_SCENARIO), classes, 'empty scenario leaves classes alone');
eq(applyScenarioToClasses([classes[0]], { ...NO_SCENARIO, investMonthlyNzd: 100 }).find((c) => c.key === 'shares')?.monthlyAdditionNzd, 100, 'shares class added when missing');

// Parsing.
eq(parseScenario({ extraSaving: '200', invest: '500' }), { ok: true, value: { extraSavingMonthlyNzd: 200, extraIncomeMonthlyNzd: 0, investMonthlyNzd: 500, mortgageRateChangePct: 0 } }, 'parse');
eq(parseScenario({ invest: '-5' }).ok, false, 'negative invest refused');
eq(parseScenario({ mortgageRate: 'x' }).ok, false, 'bad number refused');

// HTTP: the user's own projection with and without the change.
const { getDb, run } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: projectionsRouter } = await import('../routes/projections.ts');
const db = await getDb();
const now = new Date().toISOString();
run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('sc','sc@example.com','h',?,?)`, [now, now]);
run(db, `INSERT INTO bank_accounts (id, user_id, name, account_type, balance, currency, created_at, updated_at) VALUES ('scacc','sc','Everyday','checking',5000,'NZD',?,?)`, [now, now]);
const app = express();
app.use('/api', attachUser);
app.use('/api/projections', projectionsRouter);
const server: Server = await new Promise((r) => {
  const sv = app.listen(0, '127.0.0.1', () => r(sv));
});
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const cookie = `${SESSION_COOKIE}=${(await createSession('sc')).rawToken}`;
  const r = await fetch(`${url}/api/projections/scenario?months=12&extraSaving=200&mortgageRate=1`, { headers: { Cookie: cookie } });
  eq(r.status, 200, 'scenario 200');
  const body = (await r.json()) as { difference: { savingsEndNzd: number; netWorthEndNzd: number }; notes: string[]; points: unknown[] };
  eq(body.difference.savingsEndNzd, 2_400, 'HTTP: $200 a month for a year');
  eq(body.notes.some((n) => n.startsWith('No mortgage')), true, 'says there is no mortgage to change');
  eq(body.points.length, 13, 'month 0 to 12');
  eq((await fetch(`${url}/api/projections/scenario?invest=-1`, { headers: { Cookie: cookie } })).status, 400, 'bad input 400');
  eq((await fetch(`${url}/api/projections/scenario`)).status, 401, 'signed out 401');
  console.log('scenario tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
