/**
 * アバター・部屋のアイコンは画像だけを受け取る (セキュリティチェックループの L、2026-10-27)。
 * ★ 以前は種類を見ず、元のファイル名の拡張子をそのまま保存名に付けていた (.html なども置けた)
 * ★ SVG は外す (中に命令を書ける形式。配るときは sandbox が効くが、アイコンに要らない)
 */
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';
import { safeExt } from './safeExt.mts';

const IMAGE_EXTS: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/heic': '.heic', 'image/heif': '.heif', 'image/avif': '.avif',
};
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif']);

export function isAllowedImage(mimetype: string | undefined): boolean {
  return !!mimetype && mimetype.toLowerCase() in IMAGE_EXTS;
}

/** 保存名の拡張子: 元の名前の拡張子が画像のものならそれ、違えば種類から決める */
export function imageExt(originalname: string | undefined, mimetype: string | undefined): string {
  const ext = safeExt(originalname);
  if (ALLOWED_EXTS.has(ext)) return ext;
  return IMAGE_EXTS[(mimetype || '').toLowerCase()] ?? '.img';
}

/** multer の fileFilter。画像でなければ受け取らない (req.file が無くなり、各口が 400 を返す) */
export function imageOnlyFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  cb(null, isAllowedImage(file.mimetype));
}
