/**
 * 口ごとに、投稿で名乗ってよい種類 (`type`) (2026-10-02、利用者判断)
 *
 * ★ 本番の使われ方 (2026-10-02 実測) に合わせた:
 *   - 画面からの投稿 (socket message:send) … 画面は type を送らない (既定の text)
 *   - REST の新規メッセージ … 画面のスタンプだけがこの口を使う
 *   - ボットの投稿 (/api/bot/push) … フォームはボットだけが作る (60 日 214 件)
 * ★ system はどの口からも作れない。入退室・通話・スタンプの完成などはサーバの中の正規の口で作る。
 *   以前は名乗れば作れた (人の発言の吹き出しで「〜が通話を開始しました」を出せた)
 * ★ form は人の口から作れない。フォームへの返信は回答として扱われる (routes/prompts.mts) ため
 * ★ 狙いは人の悪意より、ボットの口を叩く AI が変な種類を混ぜる間違いを止めること
 * ★ 画像・音声・ファイル・動画は、それぞれのアップロードの口で作る (ここでは名乗れない)
 */
export const SOCKET_POST_TYPES: readonly string[] = ['text'];
export const REST_POST_TYPES: readonly string[] = ['text', 'stamp'];
export const BOT_POST_TYPES: readonly string[] = ['text', 'form'];

export function typeNotAllowedMessage(type: unknown, allowed: readonly string[]): string {
  return `type「${String(type).slice(0, 30)}」はこの口では使えません (使えるのは ${allowed.join(' / ')})`;
}
