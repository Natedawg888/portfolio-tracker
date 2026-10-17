/**
 * Local file uploads under data/uploads/ (property / collectable / art photos).
 * Never invent valuations — photos are display-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { DATA_DIR, getDb, queryAll, queryOne } from '../db/index.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';

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
  fs.mkdirSync(path.join(UPLOADS_DIR, 'warranties'), { recursive: true });
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

export const WARRANTIES_DIR = path.join(UPLOADS_DIR, 'warranties');

/** Save a warranty's receipt / warranty card (KAN-61); returns relative path warranties/<id><ext>. */
export function saveWarrantyReceipt(warrantyId: string, dataUrlOrBase64: string): string {
  ensureUploadDirs();
  const decoded = decodeReceiptBase64(dataUrlOrBase64);
  if (!decoded) {
    throw new Error('Invalid receipt — use JPEG/PNG/WebP/GIF/PDF data URL or base64 (max 8MB)');
  }
  const safeId = warrantyId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  for (const e of RECEIPT_EXT) {
    const prev = path.join(WARRANTIES_DIR, `${safeId}${e}`);
    if (fs.existsSync(prev)) fs.unlinkSync(prev);
  }
  const rel = `warranties/${safeId}${decoded.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, rel), decoded.buffer);
  return rel;
}

export const PAYSLIPS_DIR = path.join(UPLOADS_DIR, 'payslips');

/** Save an uploaded payslip (KAN-78); returns relative path payslips/<id><ext>. */
export function savePayslipFile(payslipId: string, dataUrlOrBase64: string): string {
  fs.mkdirSync(PAYSLIPS_DIR, { recursive: true });
  const decoded = decodeReceiptBase64(dataUrlOrBase64);
  if (!decoded) {
    throw new Error('Invalid file — use a JPEG/PNG/WebP/GIF photo or a PDF (max 8MB)');
  }
  const safeId = payslipId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  for (const e of RECEIPT_EXT) {
    const prev = path.join(PAYSLIPS_DIR, `${safeId}${e}`);
    if (fs.existsSync(prev)) fs.unlinkSync(prev);
  }
  const rel = `payslips/${safeId}${decoded.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, rel), decoded.buffer);
  return rel;
}

const UPLOAD_FOLDERS = new Set(['properties', 'collectables', 'art', 'avatars', 'receipts', 'warranties', 'payslips', 'business-logos']);

/** Relative path `folder/file` under data/uploads, or null if it is not a single file there. */
export function normalizeUploadRel(rawPath: string): string | null {
  let decoded = rawPath.split('?')[0] ?? '';
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  let rel = decoded.replace(/\\/g, '/');
  const marker = '/api/uploads/';
  const at = rel.indexOf(marker);
  if (at >= 0) rel = rel.slice(at + marker.length);
  rel = rel.replace(/^\/+/, '');
  if (!rel || rel.includes('\0')) return null;
  const parts = rel.split('/');
  if (parts.length !== 2) return null;
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  const [folder, file] = parts;
  if (!UPLOAD_FOLDERS.has(folder)) return null;
  if (!/^[\w.-]+$/.test(file)) return null;
  return `${folder}/${file}`;
}

function storedPathMatches(stored: string | null | undefined, rel: string): boolean {
  if (!stored) return false;
  const s = stored.trim();
  if (!s || s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://')) return false;
  const normalized = s.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^api\/uploads\//, '');
  return normalized === rel;
}

/** True when this user owns the receipt, photo, or avatar stored at `rel`. */
export function userOwnsUpload(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  rel: string,
): boolean {
  const folder = rel.split('/')[0];
  if (folder === 'avatars') {
    const row = queryOne<{ avatar_url: string | null }>(
      db,
      `SELECT avatar_url FROM users WHERE id = ?`,
      [userId],
    );
    return storedPathMatches(row?.avatar_url, rel);
  }
  if (folder === 'receipts') {
    const rows = queryAll<{ p: string | null }>(
      db,
      `SELECT receipt_path AS p FROM transactions WHERE user_id = ? AND receipt_path IS NOT NULL`,
      [userId],
    );
    return rows.some((r) => storedPathMatches(r.p, rel));
  }
  if (folder === 'warranties') {
    const rows = queryAll<{ p: string | null }>(
      db,
      `SELECT receipt_path AS p FROM warranties WHERE user_id = ? AND receipt_path IS NOT NULL`,
      [userId],
    );
    return rows.some((r) => storedPathMatches(r.p, rel));
  }
  if (folder === 'business-logos') {
    const rows = queryAll<{ p: string | null }>(db, `SELECT logo_path AS p FROM businesses WHERE user_id = ? AND logo_path IS NOT NULL`, [userId]);
    return rows.some((r) => storedPathMatches(r.p, rel));
  }
  if (folder === 'payslips') {
    const rows = queryAll<{ p: string | null }>(db, `SELECT file_path AS p FROM payslips WHERE user_id = ? AND file_path IS NOT NULL`, [userId]);
    return rows.some((r) => storedPathMatches(r.p, rel));
  }
  if (folder === 'properties' || folder === 'collectables' || folder === 'art') {
    const rows = queryAll<{ p: string | null }>(
      db,
      `SELECT photo_path AS p FROM holdings WHERE user_id = ? AND photo_path IS NOT NULL`,
      [userId],
    );
    return rows.some((r) => storedPathMatches(r.p, rel));
  }
  return false;
}

function requestUploadRel(req: Request): string | null {
  const candidates = [req.path, req.url, req.originalUrl];
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    const rel = normalizeUploadRel(c);
    if (rel) return rel;
  }
  return null;
}

/**
 * GET/HEAD for files the signed-in user owns. Other methods fall through.
 * Missing and not-owned paths are the same 404. Not world-readable.
 */
export function uploadsGate() {
  return async function ownedUploads(req: Request, res: Response, next: NextFunction) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const userId = (req as AuthedRequest).user?.id ?? null;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
      return;
    }
    const rel = requestUploadRel(req);
    if (!rel) {
      res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      return;
    }
    const db = await getDb();
    if (!userOwnsUpload(db, userId, rel)) {
      res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      return;
    }
    const root = path.resolve(UPLOADS_DIR);
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(rel, { root, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      }
    });
  };
}

export const BUSINESS_LOGOS_DIR = path.join(UPLOADS_DIR, 'business-logos');

/** Business logo (KAN-84); returns relative path business-logos/<businessId><ext>. */
export function saveBusinessLogo(businessId: string, dataUrlOrBase64: string): string {
  ensureUploadDirs();
  fs.mkdirSync(BUSINESS_LOGOS_DIR, { recursive: true });
  const decoded = decodeImageBase64(dataUrlOrBase64);
  if (!decoded) {
    throw new Error('Invalid image — use JPEG/PNG/WebP/GIF data URL or base64 (max 8MB)');
  }
  for (const e of ALLOWED_EXT) {
    const prev = path.join(BUSINESS_LOGOS_DIR, `${businessId}${e}`);
    if (fs.existsSync(prev)) fs.unlinkSync(prev);
  }
  const rel = `business-logos/${businessId}${decoded.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, rel), decoded.buffer);
  return rel;
}

export function deleteBusinessLogo(logoPath: string | null | undefined) {
  if (!logoPath || !logoPath.startsWith('business-logos/')) return;
  const abs = path.join(UPLOADS_DIR, logoPath);
  if (abs.startsWith(BUSINESS_LOGOS_DIR) && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
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

/** Remove a warranty's receipt file (same rules as charity receipts). */
export function deleteWarrantyReceipt(receiptPath: string | null | undefined) {
  deleteCharityReceipt(receiptPath);
}

/** Remove an uploaded payslip file (KAN-78). */
export function deletePayslipFile(filePath: string | null | undefined) {
  deleteCharityReceipt(filePath);
}
