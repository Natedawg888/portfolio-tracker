/**
 * Production routing smoke: one Express process, NODE_ENV=production, SPA + /api.
 * POST /api/auth/login and /api/auth/register must be JSON, never 405.
 * Run: npm run test:prod-routing
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no port'));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

type Hit = { status: number; text: string; type: string; allow: string | null };

async function hit(url: string, init?: RequestInit): Promise<Hit> {
  const res = await fetch(url, init);
  const text = await res.text();
  return {
    status: res.status,
    text,
    type: res.headers.get('content-type') ?? '',
    allow: res.headers.get('allow'),
  };
}

function jsonBody(hitResult: Hit): Record<string, unknown> {
  assert(
    hitResult.type.includes('application/json'),
    `expected JSON, got ${hitResult.status} type=${hitResult.type} allow=${hitResult.allow} body=${hitResult.text.slice(0, 180)}`,
  );
  return JSON.parse(hitResult.text) as Record<string, unknown>;
}

async function main() {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-dist-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-data-'));
  fs.mkdirSync(path.join(distDir, 'assets'));
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<!doctype html><title>Portfolio Tracker</title><div id="root"></div>\n',
  );
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("asset")\n');

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let logs = '';

  const stop = () => {
    if (child && !child.killed) child.kill('SIGTERM');
  };

  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(port),
        DATABASE_PATH: path.join(dataDir, 'portfolio.db'),
        SPA_DIST_DIR: distDir,
        COOKIE_SECURE: 'false',
        LOG_FORMAT: 'pretty',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (buf: Buffer) => {
      logs += buf.toString();
    });
    child.stderr?.on('data', (buf: Buffer) => {
      logs += buf.toString();
    });

    const deadline = Date.now() + 30_000;
    let health: Hit | null = null;
    while (Date.now() < deadline) {
      if (child.exitCode != null) {
        throw new Error(`server exited ${child.exitCode}\n${logs}`);
      }
      try {
        health = await hit(`${base}/api/health`);
        if (health.status === 200) break;
      } catch {
        /* still booting */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert(health && health.status === 200, `health never came up\n${logs}`);
    const healthJson = jsonBody(health!);
    assert(healthJson.ok === true, `health ok flag: ${health!.text}`);

    const badLogin = await hit(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'nope' }),
    });
    assert(badLogin.status !== 405, `login 405 allow=${badLogin.allow} body=${badLogin.text}`);
    const badLoginJson = jsonBody(badLogin);
    assert(badLogin.status === 401, `login status ${badLogin.status} ${badLogin.text}`);
    assert(
      badLoginJson.code === 'INVALID_CREDENTIALS',
      `login reached auth handler, got ${badLogin.text}`,
    );

    const email = `routing-${Date.now()}@example.com`;
    const password = 'testpass1';
    const registered = await hit(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        firstName: 'Route',
        lastName: 'Check',
      }),
    });
    assert(registered.status !== 405, `register 405 allow=${registered.allow}`);
    const registeredJson = jsonBody(registered);
    assert(registered.status === 201, `register status ${registered.status} ${registered.text}`);
    assert(
      (registeredJson.user as { email?: string } | undefined)?.email === email,
      `register user: ${registered.text}`,
    );

    const login = await hit(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert(login.status !== 405, `login after register 405`);
    const loginJson = jsonBody(login);
    assert(login.status === 200, `login status ${login.status} ${login.text}`);
    assert(
      (loginJson.user as { email?: string } | undefined)?.email === email,
      `login user: ${login.text}`,
    );

    // Unknown finance routes are gated (401 JSON). Unknown public auth routes 404 JSON.
    // Neither may be a static 405.
    const gated = await hit(`${base}/api/does-not-exist`, { method: 'POST' });
    assert(gated.status === 401, `gated api ${gated.status} ${gated.text}`);
    assert(jsonBody(gated).code === 'UNAUTHORIZED', gated.text);
    assert(gated.allow == null, `gated api Allow=${gated.allow}`);

    const missing = await hit(`${base}/api/auth/does-not-exist`, { method: 'POST' });
    assert(missing.status === 404, `missing api ${missing.status} ${missing.text}`);
    assert(jsonBody(missing).code === 'NOT_FOUND', missing.text);
    assert(missing.allow == null, `missing api should not advertise Allow, got ${missing.allow}`);

    const postSpa = await hit(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert(postSpa.status === 404, `POST /login ${postSpa.status} allow=${postSpa.allow}`);
    assert(postSpa.status !== 405, 'POST /login must not 405');
    assert(jsonBody(postSpa).code === 'NOT_FOUND', postSpa.text);

    const home = await hit(`${base}/`);
    assert(home.status === 200, `GET / ${home.status}`);
    assert(home.type.includes('text/html'), home.type);
    assert(home.text.includes('Portfolio Tracker'), home.text.slice(0, 120));

    const clientRoute = await hit(`${base}/login`);
    assert(clientRoute.status === 200 && clientRoute.text.includes('<div id="root">'), 'SPA fallback');

    const asset = await hit(`${base}/assets/app.js`);
    assert(asset.status === 200, `asset ${asset.status}`);
    assert(asset.text.includes('console.log("asset")'), asset.text);

    const assetHead = await hit(`${base}/assets/app.js`, { method: 'HEAD' });
    assert(assetHead.status === 200, `HEAD asset ${assetHead.status}`);

    console.log('prod routing ok', {
      health: healthJson.ok,
      register: registered.status,
      login: login.status,
      spa: home.status,
    });
  } finally {
    stop();
    if (child) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child?.kill('SIGKILL');
          resolve();
        }, 5_000);
        child?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
