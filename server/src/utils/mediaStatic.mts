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
import express from 'express';

export const MEDIA_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads';

const NOT_SANDBOXED = /\.pdf$/i;

export function applyMediaHeaders(res: { setHeader(name: string, value: string): void }, filePath: string): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!NOT_SANDBOXED.test(filePath)) res.setHeader('Content-Security-Policy', MEDIA_SANDBOX);
}

export function mediaStatic(root: string) {
  return express.static(root, { setHeaders: applyMediaHeaders });
}
