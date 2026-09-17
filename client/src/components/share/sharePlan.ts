/**
 * 共有 (#130 Web Share Target) で **何が送られるか**を先に決める。
 *
 * ★★★★★ なぜ要るか (2026-09-17、#445)
 *
 * LINE から動画を共有したのに **ルームが開くだけで何も入らない**、という報告が出た。
 * ★ 原因は端末側 (★★ LINE / Android / 空き容量) だったが、★★★ いちばん高くついたのは
 *   **黙って失敗したこと**だった —— ★ ルームが開くので **成功したように見える**。
 *
 * ```
 * 旧: if (text)  送る          ← 空ならスキップ
 *     if (files) 送る          ← 空ならスキップ
 *     navigate(ルームへ)       ← ★★★★ 何も送らずに遷移する
 * ```
 *
 * ★★ **原因が端末側でも、これは直す価値がある。** ★★★ 次に同じことが起きたとき、
 *   **「送るものが無かった」と「送ったが失敗した」が区別できる**ようになる。
 *
 * ★ この経路は 5 か月 毎営業日 動いていた (★★ 朝礼動画 15 件 / 09-15 まで)。
 *   ★★★ 壊れたのは 09-17 で、クライアントは 09-13 のビルドのまま無変更だった。
 */

export interface SharePlan {
  /** テキスト / URL を送るか */
  willSendText: boolean;
  /** ファイルをアップロードするか */
  willUpload: boolean;
  /** ★ 送るものが 1 つも無い —— ★★ このとき遷移させない */
  nothing: boolean;
}

/**
 * 共有内容から「何が送られるか」を決める。★ 純関数。
 *
 * ★★ `nothing` が true のとき、呼び出し側は **遷移せずに理由を出すこと**。
 *   ★★★ 黙ってルームを開くと、利用者には成功に見える。
 */
export function planShare(content: string | null | undefined, files: File[] | null | undefined): SharePlan {
  const willSendText = Boolean(content && content.trim());
  const willUpload = Boolean(files && files.length > 0);
  return { willSendText, willUpload, nothing: !willSendText && !willUpload };
}
