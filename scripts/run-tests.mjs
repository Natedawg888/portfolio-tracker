/**
 * Runs the CI test suites in parallel, one process per test file.
 *
 * Each suite is still its own `npm run test:<name>` script in package.json (run those one at a
 * time while working on something). This runner reads those scripts, splits them on `&&` into
 * single test commands, and runs the commands side by side. Every test file makes its own temp
 * database and listens on port 0, so they don't share state.
 *
 *   npm run test:ci                 every suite in CI_SUITES
 *   npm run test:ci -- business 2fa only those suites
 *   TEST_JOBS=2 npm run test:ci     limit how many run at once (default: CPU count)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const CI_SUITES = [
  'metals', 'cash-sync', 'prod-routing', 'isolation', 'passkeys', 'security-page', 'dividends',
  'home-snapshot', 'savings-goals', 'page-cache', 'dashboard', 'budget', 'account', 'linked-accounts',
  'account-switcher', 'paye', 'wff', 'payslips', 'vehicles', 'kiwisaver-calc', 'crypto', 'bonds',
  'commodities', 'crypto-mining', 'db-migrations', 'mortgage', 'retirement', 'home', 'paye-page',
  'output-pay', 'debts', 'portfolio', 'value-search', 'kiwisaver', 'history', 'donations',
  'integrations', 'receipts', 'export', 'tax-year', 'alerts', 'timeline', 'fif', 'projections',
  'projections-page', 'net-worth-crypto', '2fa', 'wallets', 'chain', 'invoices', 'business', 'bills',
  'rentals', 'shopping', 'settings-categories', 'onboarding', 'tour', 'onboarding-categories', 'plans',
  'billing', 'links', 'akahu', 'household',
];

const scripts = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
const suites = process.argv.slice(2).length ? process.argv.slice(2) : CI_SUITES;
const jobs = [];
for (const suite of suites) {
  const script = scripts[`test:${suite}`];
  if (!script) {
    console.error(`No npm script test:${suite}`);
    process.exit(2);
  }
  for (const command of script.split('&&')) jobs.push({ suite, command: command.trim() });
}

const limit = Math.max(1, Number(process.env.TEST_JOBS) || os.availableParallelism());
// Slowest first, so a long file doesn't start last and hold up the finish.
const SLOW = /prod-routing|business\/|security\/|chain\/|households\/|auth\//;
jobs.sort((a, b) => Number(SLOW.test(b.command)) - Number(SLOW.test(a.command)));

function runJob(job) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(job.command, { shell: true, env: process.env });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code, signal) => resolve({ ...job, ok: code === 0, code: code ?? signal, ms: Date.now() - started, output }));
  });
}

const started = Date.now();
const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const result = await runJob(jobs[next++]);
    results.push(result);
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${String(result.ms).padStart(6)}ms  test:${result.suite}  ${result.command.replace(/^.*--import tsx /, '')}`);
  }
}
await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));

const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  console.log(`\n===== FAIL test:${r.suite} (exit ${r.code}): ${r.command}\n${r.output.trimEnd()}`);
}
console.log(`\n${results.length - failed.length}/${results.length} test files passed in ${((Date.now() - started) / 1000).toFixed(1)}s (${limit} at a time).`);
process.exit(failed.length ? 1 : 0);
