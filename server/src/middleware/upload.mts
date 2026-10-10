import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { safeExt } from '../utils/safeExt.mts';

export const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(import.meta.dirname, '../../../media');

// File size limits (bytes)
export const SIZE_LIMITS = {
  image: 10 * 1024 * 1024,    // 10MB
  video: 1024 * 1024 * 1024,  // 1GB
  default: 100 * 1024 * 1024, // 100MB
};

/** 種類ごとの上限 (画面の constants/ui.ts と同じ値) */
export function sizeLimitFor(mimetype: string): number {
  if (mimetype.startsWith('image/')) return SIZE_LIMITS.image;
  if (mimetype.startsWith('video/')) return SIZE_LIMITS.video;
  return SIZE_LIMITS.default;
}

/**
 * ★ #497 種類ごとの上限を超えたファイルを探す。
 *   multer には 1 つの上限 (いちばん大きい 1GB) しか渡せないので、受け取った後にここで確かめる。
 *   それまでは画面だけが 10MB / 100MB で止めていて、サーバーは種類を問わず 1GB まで受け取っていた
 */
export function findOversizedFile(files: Array<{ originalname: string; mimetype: string; size: number }>): { name: string; limitMb: number } | null {
  for (const f of files) {
    const limit = sizeLimitFor(f.mimetype);
    if (f.size > limit) return { name: decodeFileName(f.originalname), limitMb: Math.round(limit / (1024 * 1024)) };
  }
  return null;
}

/**
 * ★ #529 受け取った直後に種類ごとの上限を確かめる (#497 と同じ判定)。超えていたら保存済みのファイルを消して 413。
 *   #497 は画面の口 (routes/media.mts) だけに入れていて、ボットの口 (/push-image・/push-file) は
 *   multer の 1GB 一本だけで受けていた。upload.single(...) の直後に置く
 */
export async function rejectOversizedUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  const received = (req.files as Express.Multer.File[] | undefined) || (req.file ? [req.file] : []);
  const over = findOversizedFile(received);
  if (!over) { next(); return; }
  await Promise.all(received.map((f) => fs.promises.unlink(f.path).catch(() => {})));
  res.status(413).json({ error: `${over.name} のサイズが上限（${over.limitMb}MB）を超えています` });
}

// multer/busboy decodes the multipart `filename` header as latin1, so multibyte
// (UTF-8) filenames arrive mojibake'd (e.g. 出品票.md → åºå...).
// Re-interpret the bytes as UTF-8 to recover the original name. If the bytes are
// not valid UTF-8 (a genuine latin1 name), keep the original instead of emitting
// replacement chars.
export function decodeFileName(name: string): string {
  if (!name || typeof name !== 'string') return name;
  const reinterpreted = Buffer.from(name, 'latin1').toString('utf8');
  if (reinterpreted.includes('�')) return name;
  return reinterpreted;
}

// Determine subdirectory based on MIME type
export function getSubdir(mimetype: string): string {
  if (mimetype.startsWith('image/')) return 'images';
  if (mimetype.startsWith('video/')) return 'videos';
  return 'files';
}

// Determine message type from MIME type
export function getMessageType(mimetype: string): string {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'file';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subdir = getSubdir(file.mimetype);
    cb(null, path.join(MEDIA_ROOT, subdir));
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random.ext
    const ext = safeExt(file.originalname);   // ★ #561 英数字だけ (元の名前の拡張子をそのまま付けない)
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: SIZE_LIMITS.video, // Use largest limit; fine-tune per type if needed
  },
});
