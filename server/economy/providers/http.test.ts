/**
 * The download client follows redirects and surfaces HTTP errors.
 * Run: npm run test:economy
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchText } from './http.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const server = http.createServer((req, res) => {
  if (req.url === '/ok') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('hello');
    return;
  }
  if (req.url === '/go') {
    res.writeHead(302, { Location: '/ok' });
    res.end();
    return;
  }
  if (req.url === '/go-cookie') {
    res.writeHead(302, {
      Location: '/need-cookie',
      'Set-Cookie': 'wb-p-SERVER=app1; path=/',
    });
    res.end();
    return;
  }
  if (req.url === '/need-cookie') {
    const ok = String(req.headers.cookie ?? '').includes('wb-p-SERVER=app1');
    res.writeHead(ok ? 200 : 500, { 'Content-Type': 'text/plain' });
    res.end(ok ? 'cookie-ok' : 'missing-cookie');
    return;
  }
  res.writeHead(500);
  res.end('nope');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

const body = await fetchText(`${base}/ok`);
assert(body === 'hello', `body ${body}`);
const redirected = await fetchText(`${base}/go`);
assert(redirected === 'hello', `redirect ${redirected}`);
const withCookie = await fetchText(`${base}/go-cookie`);
assert(withCookie === 'cookie-ok', `redirect cookie ${withCookie}`);
let failed = false;
try {
  await fetchText(`${base}/missing`);
} catch (err) {
  failed = err instanceof Error && err.message.includes('HTTP 500');
}
assert(failed, 'HTTP 500 is an error');

server.close();
console.log('4 http client tests passed');
