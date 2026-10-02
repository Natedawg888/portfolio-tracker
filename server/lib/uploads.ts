/**
 * Local file uploads under data/uploads/ (property / collectable / art photos).
 * Never invent valuations — photos are display-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../db/index.ts';

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const PROPERTIES_DIR = path.join(UPLOADS_DIR, 'properties');
export const ART_DIR = path.join(UPLOADS_DIR, 'art');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export function ensureUploadDirs() {
  fs.mkdirSync(PROPERTIES_DIR, { recursive: true });
  fs.mkdirSync(path.join(UPLOADS_DIR, 'collectables'), { recursive: true });
  fs.mkdirSync(ART_DIR, { recursive: true });
  fs.mkdirSync(path.join(UPLOADS_DIR, 'avatars'), { recursive: true });
  fs.mkdirSync(path.join(UPLOADS_DIR, 'receipts'), { recursive: true });
}

/** Parse data URL or raw base64; returns { buffer, ext } or null. */
export function decodeImageBase64(
  input: string,
): { buffer: Buffer; ext: string; mime: string } | null {
  const raw = input.trim();
  let mime = 'image/jpeg';
  let b64 = raw;
  const m = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (m) {
    mime = m[1].toLowerCase();
    b64 = m[2];
  }
  const extMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  const ext = extMap[mime] ?? '.jpg';
  if (!ALLOWED_EXT.has(ext)) return null;
  try {
    const buffer = Buffer.from(b64.replace(/\s/g, ''), 'base64');
    if (buffer.length < 32 || buffer.length > 8 * 1024 * 1024) return null;
    return { buffer, ext, mime };
  } catch {
    return null;
  }
}

/** Save property photo; returns relative path `properties/<id><ext>` for DB. */
export function savePropertyPhoto(holdingId: string, dataUrlOrBase64: string): string {
  ensureUploadDirs();
  const decoded = decodeImageBase64(dataUrlOrBase64);
  if (!decoded) {
    throw new Error('Invalid image — use JPEG/PNG/WebP/GIF data URL or base64 (max 8MB)');
  }
  // Remove prior extensions for this holding
  for (const e of ALLOWED_EXT) {
    const prev = path.join(PROPERTIES_DIR, `${holdingId}${e}`);
    if (fs.existsSync(prev)) fs.unlinkSync(prev);
  }
  const rel = `properties/${holdingId}${decoded.ext}`;
  const abs = path.join(UPLOADS_DIR, rel);
  fs.writeFileSync(abs, decoded.buffer);
  return rel;
}

export function deletePropertyPhoto(photoPath: string | null | undefined) {
  if (!photoPath) return;
  const abs = path.join(UPLOADS_DIR, photoPath);
  if (abs.startsWith(UPLOADS_DIR) && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
}

export function photoUrlFromPath(photoPath: string | null | undefined): string | null {
  if (!photoPath) return null;
  return `/api/uploads/${photoPath.replace(/^\/+/, '')}`;
}

export const COLLECTABLES_DIR = path.join(UPLOADS_DIR, 'collectables');

export function ensureCollectableUploadDirs() {
  ensureUploadDirs();
  fs.mkdirSync(COLLECTABLES_DIR, { recursive: true });
}

/** Save collectable item/card photo; returns relative path collectables/<id><ext>. */
export function saveCollectablePhoto(holdingId: string, dataUrlOrBase64: string): string {
  ensureCollectableUploadDirs();
  const decoded = decodeImageBase64(dataUrlOrBase64);
  if (!decoded) {
    throw new Error('Invalid image — use JPEG/PNG/WebP/GIF data URL or base64 (max 8MB)');
  }
  for (const e of ALLOWED_EXT) {
    const prev = path.join(COLLECTABLES_DIR, `${holdingId}${e}`);
    if (fs.existsSync(prev)) fs.unlinkSync(prev);
  }
  const rel = `collectables/${holdingId}${decoded.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, rel), decoded.buffer);
  return rel;
}

export function ensureArtUploadDirs() {
  ensureUploadDirs();
  fs.mkdirSync(ART_DIR, { recursive: true });
}

/** Save physical art photo; returns relative path art/<id><ext>. */
export function saveArtPhoto(holdingId: string, dataUrlOrBase64: string): string {
  ensureArtUploadDirs();
  const decoded = decodeImageBase64(dataUrlOrBase64);
  if (!decoded) {
    throw new Error('Invalid image — use JPEG/PNG/WebP/GIF data URL or base64 (max 8MB)');
  }
  for (const e of ALLOWED_EXT) {
    const prev = path.join(ART_DIR, `${holdingId}${e}`);
    if (fs.existsSync(prev)) fs.unlinkSync(prev);
  }
  const rel = `art/${holdingId}${decoded.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, rel), decoded.buffer);
  return rel;
}

export const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');

export function ensureAvatarUploadDirs() {
  ensureUploadDirs();
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

/** Save user profile avatar; returns relative path avatars/<userId><ext>. */
export function saveUserAvatar(userId: string, dataUrlOrBase64: string): string {
  ensureAvatarUploadDirs();
  const decoded = decodeImageBase64(dataUrlOrBase64);
  if (!decoded) {
    throw new Error('Invalid image — use JPEG/PNG/WebP/GIF data URL or base64 (max 8MB)');
  }
  for (const e of ALLOWED_EXT) {
    const prev = path.join(AVATARS_DIR, `${userId}${e}`);
    if (fs.existsSync(prev)) fs.unlinkSync(prev);
  }
  const rel = `avatars/${userId}${decoded.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, rel), decoded.buffer);
  return rel;
}

export function deleteAvatarFile(avatarPath: string | null | undefined) {
  if (!avatarPath) return;
  if (avatarPath.startsWith('data:')) return;
  const abs = path.join(UPLOADS_DIR, avatarPath.replace(/^\/+/, ''));
  if (abs.startsWith(UPLOADS_DIR) && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
}

export const RECEIPTS_DIR = path.join(UPLOADS_DIR, 'receipts');

const RECEIPT_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf']);

export function ensureReceiptUploadDirs() {
  ensureUploadDirs();
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

/** Decode image or PDF data URL / raw base64 for charity receipts (max 8MB). */
export function decodeReceiptBase64(
  input: string,
): { buffer: Buffer; ext: string; mime: string } | null {
  const raw = input.trim();
  let mime = 'image/jpeg';
  let b64 = raw;
  const m = raw.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/s);
  if (m) {
    mime = m[1].toLowerCase();
    b64 = m[2];
  }
  const extMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
  };
  const ext = extMap[mime] ?? (mime.includes('pdf') ? '.pdf' : '.jpg');
  if (!RECEIPT_EXT.has(ext)) return null;
  try {
    const buffer = Buffer.from(b64.replace(/\s/g, ''), 'base64');
    if (buffer.length < 32 || buffer.length > 8 * 1024 * 1024) return null;
    return { buffer, ext, mime };
  } catch {
    return null;
  }
}

/** Save charity / IR526 receipt; returns relative path receipts/<txnId><ext>. */
export function saveCharityReceipt(txnId: string, dataUrlOrBase64: string): string {
  ensureReceiptUploadDirs();
  const decoded = decodeReceiptBase64(dataUrlOrBase64);
  if (!decoded) {
    throw new Error('Invalid receipt — use JPEG/PNG/WebP/GIF/PDF data URL or base64 (max 8MB)');
  }
  for (const e of RECEIPT_EXT) {
    const prev = path.join(RECEIPTS_DIR, `${txnId}${e}`);
    if (fs.existsSync(prev)) fs.unlinkSync(prev);
  }
  const safeId = txnId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const rel = `receipts/${safeId}${decoded.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, rel), decoded.buffer);
  return rel;
}

export function deleteCharityReceipt(receiptPath: string | null | undefined) {
  if (!receiptPath) return;
  const abs = path.join(UPLOADS_DIR, receiptPath.replace(/^\/+/, ''));
  if (abs.startsWith(UPLOADS_DIR) && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
}
