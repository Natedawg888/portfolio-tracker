/**
 * Debt rows, interest postings, and income stay on the user who recorded them.
 * Run: npm run test:debts
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `pt-debts-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-6) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

const { getDb, run } = await import('../db/index.ts');
const { applyScheduledInterestForUser, createDebt, listDebtsForUser, updateDebt } = await import('./store.ts');

const userA = 'debttest_user_a';
const userB = 'debttest_user_b';

async function main() {
  const db = await getDb();
  try {
    const debtA = createDebt(
      db,
      userA,
      {
        name: 'A card',
        kind: 'corporation',
        notes: null,
        outstandingNzd: 1200,
        productKind: 'credit_card',
        isLoan: false,
        interestPeriod: 'month',
        interestRatePercent: 12,
        minimumPaymentNzd: 25,
        actualPaymentNzd: 100,
        remainingTermMonths: null,
        interestPaidNzd: null,
      },
      '2026-10-05',
    );
    eq(debtA.outstandingNzd, 1200, 'user A balance is the amount they entered on 5 October');
    assert(debtA.isLoan === false, 'user A debt is not marked as a loan');
    assert(debtA.interestPeriod === 'month', 'user A interest recurs monthly');

    const debtB = createDebt(
      db,
      userB,
      {
        name: 'B loan',
        kind: 'person',
        notes: null,
        outstandingNzd: 5000,
        productKind: 'personal_loan',
        isLoan: true,
        interestPeriod: 'year',
        interestRatePercent: 10,
        minimumPaymentNzd: 80,
        actualPaymentNzd: 200,
        remainingTermMonths: 24,
        interestPaidNzd: 15,
      },
      '2026-06-15',
    );
    eq(debtB.outstandingNzd, 5000, 'user B balance is the amount they entered');
    assert(debtB.isLoan === true, 'user B debt is marked as a loan');
    assert(debtB.interestPeriod === 'year', 'user B interest recurs yearly');

    applyScheduledInterestForUser(db, userA, '2026-11-01');
    const afterA = listDebtsForUser(db, userA, '2026-11-01');
    const afterB = listDebtsForUser(db, userB, '2026-11-01');
    eq(afterA[0]?.outstandingNzd, 1212, 'user A monthly interest is added on 1 November');
    eq(afterA[0]?.interestChargedNzd, 12, 'user A interest added is one twelfth of 12% of 1200');
    eq(afterB[0]?.outstandingNzd, 5000, 'posting user A interest leaves user B balance unchanged');
    assert(afterB[0]?.interestPeriod === 'year', 'user B still recurs yearly');
    assert(afterB[0]?.isLoan === true, 'user B loan flag stays set');

    applyScheduledInterestForUser(db, userB, '2026-12-31');
    const yearEndB = listDebtsForUser(db, userB, '2026-12-31');
    eq(yearEndB[0]?.outstandingNzd, 5000, 'user B yearly interest is not added on 31 December');

    applyScheduledInterestForUser(db, userB, '2027-01-01');
    const janB = listDebtsForUser(db, userB, '2027-01-01');
    const janA = listDebtsForUser(db, userA, '2027-01-01');
    eq(janB[0]?.outstandingNzd, 5500, 'user B yearly interest is added on 1 January');
    eq(janB[0]?.interestChargedNzd, 500, 'user B interest added is 10% of 5000');
    eq(janA[0]?.outstandingNzd, 1236.36, 'user A keeps their own monthly schedule through January');
    assert(
      Math.abs((janA[0]?.outstandingNzd ?? 0) - (janB[0]?.outstandingNzd ?? 0)) > 1,
      'the two users do not share a balance',
    );

    const stolen = updateDebt(
      db,
      userB,
      debtA.id,
      { isLoan: true, interestPeriod: 'year', outstandingNzd: 1 },
      '2027-01-01',
    );
    assert(stolen == null, 'user B cannot update user A debt');
    const stillA = listDebtsForUser(db, userA, '2027-01-01');
    assert(stillA[0]?.isLoan === false, 'user A loan flag stays unset');
    assert(stillA[0]?.interestPeriod === 'month', 'user A schedule stays monthly');
    eq(stillA[0]?.outstandingNzd, 1236.36, 'user A balance is unchanged by the other user');

    const now = new Date().toISOString();
    run(
      db,
      `INSERT INTO income_records (id, user_id, date, amount_nzd, kind, description, created_at)
       VALUES (?, ?, '2026-11-02', 4000, 'cash', 'A pay', ?)`,
      ['inc_a', userA, now],
    );
    run(
      db,
      `INSERT INTO income_records (id, user_id, date, amount_nzd, kind, description, created_at)
       VALUES (?, ?, '2026-11-03', 9000, 'cash', 'B pay', ?)`,
      ['inc_b', userB, now],
    );

    const payoffA = createDebt(
      db,
      userA,
      {
        name: 'A payoff',
        kind: 'person',
        notes: null,
        outstandingNzd: 4400,
        productKind: 'car_loan',
        isLoan: true,
        interestPeriod: null,
        interestRatePercent: null,
        minimumPaymentNzd: null,
        actualPaymentNzd: 100,
        remainingTermMonths: null,
        interestPaidNzd: null,
      },
      '2026-11-15',
    );
    assert(
      payoffA.projectionText === 'At your current repayment rate: Debt-free in 3 years 8 months.',
      'projection uses this debt balance and payment',
    );
    eq(payoffA.debtToIncome, 100 / 4000, 'debt-to-income uses user A recorded income');
    assert(payoffA.recordedIncomeNzd === 4000, 'user A income is 4000, not user B 9000');

    const noPay = createDebt(
      db,
      userA,
      {
        name: 'A blank payment',
        kind: 'person',
        notes: null,
        outstandingNzd: 4400,
        productKind: 'bnpl',
        isLoan: false,
        interestPeriod: null,
        interestRatePercent: null,
        minimumPaymentNzd: 20,
        actualPaymentNzd: null,
        remainingTermMonths: 8,
        interestPaidNzd: null,
      },
      '2026-11-15',
    );
    assert(noPay.projectionText == null, 'missing actual payment leaves the payoff line blank');
    assert(noPay.debtToIncome == null, 'missing actual payment leaves debt-to-income blank');
    assert(noPay.minimumPaymentNzd === 20, 'minimum payment is stored without becoming the actual payment');

    const noIncome = createDebt(
      db,
      'debttest_user_c',
      {
        name: 'C loan',
        kind: 'person',
        notes: null,
        outstandingNzd: 4400,
        productKind: 'student_loan',
        isLoan: true,
        interestPeriod: null,
        interestRatePercent: null,
        minimumPaymentNzd: null,
        actualPaymentNzd: 100,
        remainingTermMonths: null,
        interestPaidNzd: null,
      },
      '2026-11-15',
    );
    assert(noIncome.debtToIncome == null, 'debt-to-income stays blank when that user has no income');
    assert(noIncome.recordedIncomeNzd == null, 'missing income is null rather than zero');
    assert(
      noIncome.projectionText === 'At your current repayment rate: Debt-free in 3 years 8 months.',
      'projection still uses only the balance and payment entered on this debt',
    );

    const listedB = listDebtsForUser(db, userB, '2027-01-01');
    assert(listedB.every((row) => row.name.startsWith('B ')), 'user B list does not include user A debts');
    assert(
      listedB[0]?.projectionText !== payoffA.projectionText,
      'user B projection is not user A payoff text',
    );
  } finally {
    for (const suffix of ['', '.tmp', '-wal', '-shm']) {
      const p = `${dbPath}${suffix}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  console.log('debt store tests ok');
}

await main();
