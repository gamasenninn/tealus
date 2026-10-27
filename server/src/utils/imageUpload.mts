/**
 * アバター・部屋のアイコンは画像だけを受け取る (セキュリティチェックループの L、2026-10-27)。
 * ★ 以前は種類を見ず、元のファイル名の拡張子をそのまま保存名に付けていた (.html なども置けた)
 * ★ SVG は外す (中に命令を書ける形式。配るときは sandbox が効くが、アイコンに要らない)
 */
import type { Request, Response, NextFunction } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import { safeExt } from './safeExt.mts';
import { logger } from './logger.mts';

const IMAGE_EXTS: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/heic': '.heic', 'image/heif': '.heif', 'image/avif': '.avif',
};
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif']);
/** 種類が分からないときに拡張子で通すもの: どのブラウザでも描けるものだけ */
const FALLBACK_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

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
  // ★ 種類が分からないとき (空・octet-stream) だけ拡張子で見る (改善ループ 17 回目)。
  //   ★ 18 回目で絞った: どのブラウザでも描ける拡張子だけ。.heic を通すと Chrome・Android では誰にも描けないアバターになり、
  //   断られないので本人も気づけない (HEIC の扱いは小野さん判断待ち)。
  //   中身が画像でなくても画面で動かないのは、/media を別オリジン扱い (CSP sandbox) で配っているから (utils/mediaStatic.mts)
  const unknownType = !file.mimetype || file.mimetype.toLowerCase() === 'application/octet-stream';
  const ok = isAllowedImage(file.mimetype) || (unknownType && FALLBACK_EXTS.has(safeExt(file.originalname)));
  if (!ok) {
    // ★ 断った種類を残す (改善ループ 17 回目)。正当な画像が application/octet-stream で届いて断られても、記録が無いと誰も気づけない
    (req as MarkedRequest)[REJECTED] = file.mimetype || '(種類なし)';
    logger.warn(`画像でないファイルを断りました: type=${String(file.mimetype).slice(0, 60)} ext=${safeExt(file.originalname) || '-'} user=${req.user?.id ?? '-'}`);
  }
  cb(null, ok);
}

/**
 * upload.single(field) を包み、multer の例外 (大きすぎる・欄が違う) を 413 / 400 で返す (改善ループ 18 回目)。
 * ★ MulterError には status が無く、そのままだと errorHandler が 500 にしていた (routes/media.mts は自前で拾っていた)
 */
export function singleImage(upload: multer.Multer, field: string, limitMb: number) {
  const mw = upload.single(field);
  return (req: Request, res: Response, next: NextFunction): void => {
    mw(req, res, (err?: unknown) => {
      if (!err) { next(); return; }
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') { res.status(413).json({ error: `画像は ${limitMb}MB までです` }); return; }
        res.status(400).json({ error: '画像を 1 つだけ添付してください' }); return;
      }
      next(err);
    });
  };
}

/** req.file が無いときの 400 の文。★ 種類で断ったのに「添付されていません」と言わない */
export function imageUploadError(req: Request): string {
  return (req as MarkedRequest)[REJECTED] !== undefined
    ? '画像 (JPEG・PNG・GIF・WebP) を選んでください'   // ★ 19 回目: HEIC・AVIF は書かない (Chrome では描けず、拡張子では通さない)
    : '画像ファイルが添付されていません';
}
