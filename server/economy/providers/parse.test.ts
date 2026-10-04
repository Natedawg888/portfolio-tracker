/**
 * CSV and ZIP readers used by the New Zealand provider.
 * Run: npm run test:economy
 */
import { deflateRawSync } from 'node:zlib';
import { collectSeries, parseCsvRows } from './csv.ts';
import { unzipEntries } from './zip.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let passed = 0;

{
  const rows = parseCsvRows('A,B\n"hello, world","a""b"\n1,2\n');
  assert(rows.length === 3, `rows ${rows.length}`);
  assert(rows[1]?.[0] === 'hello, world', `quoted ${rows[1]?.[0]}`);
  assert(rows[1]?.[1] === 'a"b', `escaped ${rows[1]?.[1]}`);
  const series = collectSeries('Series_reference,Period,Data_value\nAAA,2026.06,1.5\nBBB,2026.06,9\n', new Set(['AAA']), {
    id: ['Series_reference'],
    period: ['Period'],
    value: ['Data_value'],
  });
  assert(series.get('AAA')?.length === 1, 'kept AAA');
  assert(series.get('AAA')?.[0]?.value === 1.5, 'value');
  assert(!series.has('BBB'), 'ignored BBB');
  passed += 1;
}

{
  const payload = Buffer.from('filled-jobs,1\n', 'utf8');
  const zipped = deflateRawSync(payload);
  const name = 'jobs.csv';
  const local = Buffer.alloc(30 + name.length + zipped.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(zipped.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.write(name, 30, 'utf8');
  zipped.copy(local, 30 + name.length);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(zipped.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  central.write(name, 46, 'utf8');

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);

  const archive = Buffer.concat([local, central, eocd]);
  const entries = unzipEntries(archive);
  assert(entries.get('jobs.csv')?.toString('utf8') === payload.toString('utf8'), 'zip round-trip');
  passed += 1;
}

console.log(`${passed} parse tests passed`);
