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

type SizeLimitError = Error & { code: 'LIMIT_FILE_SIZE'; field: string; limitMb: number; fileName: string };

/**
 * 受け取りながら種類ごとの上限を数え、超えた時点で断る保存先 (2026-10-30 小野さん判断 M、#529 の K の残り)。
 *
 * ★ 以前は multer に 1 つの上限 (いちばん大きい 1GB) しか渡せず、全部を受け取って保存してから種類ごとの上限を
 *   確かめていた (findOversizedFile)。超えた時点で書き込みをやめ、途中のファイルを消して LIMIT_FILE_SIZE を返す。
 *   multer はこの失敗を受けると、受け取りを打ち切ってすぐ応答する (残りは読み捨て)
 * ★ 投げる失敗には何 MB までか (limitMb) とファイル名を載せる (断る文に使う)
 */
export function limitedDiskStorage(destinationFor: (mimetype: string) => string): multer.StorageEngine {
  return {
    _handleFile(_req, file, cb) {
      const dir = destinationFor(file.mimetype);
      // Generate unique filename: timestamp-random.ext
      const ext = safeExt(file.originalname);   // ★ #561 英数字だけ (元の名前の拡張子をそのまま付けない)
      const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      const filePath = path.join(dir, filename);
      const limit = sizeLimitFor(file.mimetype);
      let size = 0;
      let done = false;
      const finish = (err: Error | null, info?: Partial<Express.Multer.File>) => { if (!done) { done = true; cb(err, info); } };
      const out = fs.createWriteStream(filePath);
      file.stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= limit || done) return;
        file.stream.unpipe(out);
        out.destroy();
        fs.unlink(filePath, () => {});
        const err = Object.assign(new Error('LIMIT_FILE_SIZE'), {
          code: 'LIMIT_FILE_SIZE' as const, field: file.fieldname,
          limitMb: Math.round(limit / (1024 * 1024)), fileName: decodeFileName(file.originalname),
        }) satisfies SizeLimitError;
        finish(err);
        file.stream.resume();   // 残りは読み捨てる (止めたままだと multer の後片付けが進まない)
      });
      out.on('error', (err) => finish(err));
      out.on('finish', () => finish(null, { destination: dir, filename, path: filePath, size }));
      file.stream.pipe(out);
    },
    _removeFile(_req, file, cb) {
      fs.unlink(file.path, (err) => cb(err && (err as NodeJS.ErrnoException).code !== 'ENOENT' ? err : null));
    },
  };
}

/** 種類ごとの上限で断ったときの文 (limitedDiskStorage の失敗から作る)。上限を載せていない失敗 (multer 自身の 1GB) は null */
export function sizeLimitMessage(err: unknown): string | null {
  const e = err as Partial<SizeLimitError> | null;
  if (e?.code !== 'LIMIT_FILE_SIZE' || e.limitMb === undefined) return null;
  return `${e.fileName} のサイズが上限（${e.limitMb}MB）を超えています`;
}

const storage = limitedDiskStorage((mimetype) => path.join(MEDIA_ROOT, getSubdir(mimetype)));

export const upload = multer({
  storage,
  limits: {
    fileSize: SIZE_LIMITS.video, // Use largest limit; fine-tune per type if needed
  },
});

/**
 * ★ upload.single(...) の直後に置く失敗の受け口 (2026-10-30)。受け取りの途中で種類ごとの上限を超えたら 413 と理由を返す。
 *   置かないと、上限で断った失敗が Express の既定の 500 になる (ボットの口 /push-image・/push-file)
 */
export function uploadSizeError(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const msg = sizeLimitMessage(err);
  if (msg) { res.status(413).json({ error: msg }); return; }
  if ((err as { code?: string } | null)?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'ファイルサイズが上限を超えています（画像 10MB・動画 1GB・その他 100MB）' });
    return;
  }
  next(err);
}
