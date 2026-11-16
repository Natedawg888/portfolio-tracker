/**
 * Signed-out home page must not name Akahu or promise an automatic bank connection.
 * Run: npm run test:home
 */
import fs from 'node:fs';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const FILES = [
  'index.html',
  'src/pages/Home.tsx',
  'src/components/home/HomeTopBar.tsx',
  'src/components/home/PreviewCard.tsx',
  'src/lib/homePreview.ts',
];

const BANNED = [/akahu/i, /bank connection/i, /\bsync(?:ed|ing|s)?\b/i, /automatically/i, /open banking/i];

for (const file of FILES) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of BANNED) {
    assert(!pattern.test(text), `${file} matches ${pattern}`);
  }
}

const home = fs.readFileSync('src/pages/Home.tsx', 'utf8');
assert(home.includes('import them from a CSV'), 'landing names CSV import');
assert(home.includes('amounts you type in'), 'landing names manual KiwiSaver entry');
assert(home.includes('Enter balances yourself, or import a CSV'), 'hero does not promise a live bank link');
assert(fs.readFileSync('src/components/home/HomeTopBar.tsx', 'utf8').includes('BrandLockup'), 'landing header still uses the koru lockup');
assert(fs.readFileSync('src/components/BrandLockup.tsx', 'utf8').includes('/brand/koru-icon-192.png'), 'koru icon stays on the lockup');

const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('name="description"'), 'meta description is present');
assert(html.includes('og:description'), 'social description is present');
assert(html.includes('/brand/koru-icon-32.png'), 'koru favicon stays');

console.log('home public copy tests passed');
