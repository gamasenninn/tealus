/**
 * アバター・部屋のアイコンは画像だけを受け取る (セキュリティチェックループの L、2026-10-27)。
 * ★ 以前は種類を見ず、元のファイル名の拡張子をそのまま保存名に付けていた (.html なども置けた)
 * ★ SVG は外す (中に命令を書ける形式。配るときは sandbox が効くが、アイコンに要らない)
 */
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';
import { safeExt } from './safeExt.mts';
import { logger } from './logger.mts';

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

/** 種類で断ったときに req に残す印 (各口の 400 の文を分けるため) */
const REJECTED = Symbol('rejectedImageType');
type MarkedRequest = Request & { [REJECTED]?: string };

/** multer の fileFilter。画像でなければ受け取らない (req.file が無くなり、各口が 400 を返す) */
export function imageOnlyFilter(req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  // ★ 種類が分からないとき (空・octet-stream) だけ拡張子で見る (改善ループ 17 回目)。Windows の Chrome は .heic に種類を付けないことがある。
  //   保存名の拡張子は imageExt で画像のものに決まり、配るときは nosniff なので、中身が画像でなくても画面で動かない
  const unknownType = !file.mimetype || file.mimetype.toLowerCase() === 'application/octet-stream';
  const ok = isAllowedImage(file.mimetype) || (unknownType && ALLOWED_EXTS.has(safeExt(file.originalname)));
  if (!ok) {
    // ★ 断った種類を残す (改善ループ 17 回目)。正当な画像が application/octet-stream で届いて断られても、記録が無いと誰も気づけない
    (req as MarkedRequest)[REJECTED] = file.mimetype || '(種類なし)';
    logger.warn(`画像でないファイルを断りました: type=${String(file.mimetype).slice(0, 60)} ext=${safeExt(file.originalname) || '-'} user=${req.user?.id ?? '-'}`);
  }
  cb(null, ok);
}

/** req.file が無いときの 400 の文。★ 種類で断ったのに「添付されていません」と言わない */
export function imageUploadError(req: Request): string {
  return (req as MarkedRequest)[REJECTED] !== undefined
    ? '画像 (JPEG・PNG・GIF・WebP・HEIC・AVIF) だけ受け付けます'
    : '画像ファイルが添付されていません';
}
