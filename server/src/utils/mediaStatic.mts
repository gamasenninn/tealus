/**
 * /media (アップロードされたファイル) の配り方 (2026-09-30)。
 *
 * ★ アップロードされたファイルは、本体の画面と切り離して開かせる
 *   (CSP sandbox。allow-same-origin を付けないので、本体とは別のオリジンとして扱われる)。
 * ★ スクリプトは動かす —— 業務メモで HTML のドリルを開いて使っている。
 *   代わりにブラウザの保存領域は使えなくなる (try で包んでいないページはそこで止まる)。
 * ★ PDF だけは外す —— 見せ方をブラウザ内蔵のビューアに任せている形式で、sandbox 下の挙動を全ブラウザでは確かめていない
 *   (Chrome では開けることを 2026-09-30 に確認。iPhone の Safari は未確認)。確かめるまでは変えない。
 * ★ 切り離す側を「HTML・SVG…」と列挙せず「PDF 以外は全部」にしたのは、文書として開ける形式を
 *   数え漏らしても安全側に倒れるようにするため (画像・動画を直接開いたときの表示は、素の配信と比べて
 *   変わらないことを 2026-09-30 に Chrome で確認。画面の中の <img> / <video> にはこのヘッダは効かない)。
 * ★ nosniff: 拡張子と違う中身 (テキストに見せた HTML など) を、ブラウザに推測で文書扱いさせない。
 */
import fs from 'fs';
import path from 'path';
import express from 'express';
import type { RequestHandler } from 'express';

export const MEDIA_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads';

const NOT_SANDBOXED = /\.pdf$/i;

export function applyMediaHeaders(res: { setHeader(name: string, value: string): void }, filePath: string): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!NOT_SANDBOXED.test(filePath)) res.setHeader('Content-Security-Policy', MEDIA_SANDBOX);
}

export interface MediaStaticOptions {
  /**
   * #601 開かせないファイルか (削除した投稿だけが使っていた添付)。true なら 404。
   * 受け取るのは /media からの相対パス (例: images/xxx.png)。判定が失敗したら開かせない
   */
  isHidden?: (relPath: string) => Promise<boolean>;
}

export function mediaStatic(root: string, opts: MediaStaticOptions = {}): RequestHandler {
  const serve = express.static(root, { setHeaders: applyMediaHeaders });
  const { isHidden } = opts;
  if (!isHidden) return serve;
  let realRoot: string | null = null;
  return async (req, res, next) => {
    // ★ アドレスの文字列のまま突き合わせない。本番は Windows で、大文字小文字の違い・末尾の . ・%エンコード・
    //   ../ でも同じファイルが開く。実際のファイルの正式な名前 (OS に引かせる) で突き合わせる
    let rel: string;
    try {
      realRoot ??= await fs.promises.realpath(root);
      const real = await fs.promises.realpath(path.join(realRoot, decodeURIComponent(req.path)));
      rel = path.relative(realRoot, real).split(path.sep).join('/');
    } catch {
      return serve(req, res, next);   // ファイルが無い・壊れたアドレス: 今までどおり static が答える (404 / 400)
    }
    if (rel.startsWith('..') || path.isAbsolute(rel)) return serve(req, res, next);   // 外へ出るアドレスは static が断る
    try {
      if (await isHidden(rel)) { res.status(404).end(); return; }
    } catch (err) {
      next(err);   // 判定できないときは開かせない (隠すべきものを出さない側に倒す)
      return;
    }
    serve(req, res, next);
  };
}
