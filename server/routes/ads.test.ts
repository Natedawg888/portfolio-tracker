/**
 * Side ad config API (KAN-72): public, off by default, kill switch read per request,
 * no placeholders in production, nothing about the user in the response.
 * Run: npm run test:ads
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { isPublicApiPath } from '../middleware/requireAuth.ts';
import adsRouter from './ads.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const KEYS = ['ADS_ENABLED', 'ADSENSE_CLIENT_ID', 'ADSENSE_SLOT_LEFT', 'ADSENSE_SLOT_RIGHT', 'ADSENSE_SLOT_BOTTOM', 'NODE_ENV'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function setEnv(vals: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vals);
}

assert(isPublicApiPath('/ads/config'), 'config is public (signed-out pages too)');
assert(!isPublicApiPath('/ads/other'), 'only the config path is public');

const app = express();
app.use('/api/ads', adsRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ads/config`;
const get = async () => {
  const res = await fetch(url);
  return { cache: res.headers.get('cache-control'), json: (await res.json()) as Record<string, any> };
};

try {
  setEnv({ NODE_ENV: 'production' });
  let r = await get();
  assert(r.json.mode === 'off' && r.json.clientId === null, 'off by default');
  assert(r.cache === 'no-store', 'not cached, so the kill switch applies straight away');

  setEnv({ NODE_ENV: 'production', ADS_ENABLED: 'true', ADSENSE_CLIENT_ID: 'ca-pub-1234567890123456', ADSENSE_SLOT_LEFT: '1111111111', ADSENSE_SLOT_RIGHT: '2222222222', ADSENSE_SLOT_BOTTOM: '3333333333' });
  r = await get();
  assert(r.json.mode === 'adsense' && r.json.slots.left === '1111111111' && r.json.slots.bottom === '3333333333', 'on with AdSense ids');
  assert(JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['clientId', 'mode', 'slots']), 'only ad config in the response');

  process.env.ADS_ENABLED = 'false';
  assert((await get()).json.mode === 'off', 'kill switch read on every request');

  setEnv({ NODE_ENV: 'production', ADS_ENABLED: 'true' });
  assert((await get()).json.mode === 'off', 'production without AdSense ids shows nothing');
  setEnv({ NODE_ENV: 'development', ADS_ENABLED: 'true' });
  assert((await get()).json.mode === 'placeholder', 'development shows placeholders');

  console.log('ads api tests ok');
} finally {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
