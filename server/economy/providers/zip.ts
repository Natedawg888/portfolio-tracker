/**
 * Read stored or deflated ZIP entries. Enough for Stats NZ release zips.
 * ZIP64 is not handled.
 */
import { inflateRawSync } from 'node:zlib';

export function unzipEntries(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEocd(buffer);
  const total = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) {
      throw new Error('ZIP central directory header was not found');
    }
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');
    pointer += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) out.set(name, Buffer.from(compressed));
    else if (method === 8) out.set(name, inflateRawSync(compressed));
    else throw new Error(`Unsupported ZIP method ${method} for ${name}`);
  }
  return out;
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('ZIP end of central directory was not found');
}
