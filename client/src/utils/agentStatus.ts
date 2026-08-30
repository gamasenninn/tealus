/**
 * agent の status 表示に関する判定。
 *
 * status は 2 種類のものが同じ経路 (`agent:status`) を流れている:
 *
 * ```
 * ★ このボットが働いている   analyzing (Deep) / thinking / processing / searching / … (Light)
 * ★★ 別セッターへ中継した     relayed  ← cc-bridge の受領表示 (emitCcAck)
 * ```
 *
 * 後者は**走っている agent が無い**ので、中断ボタンを出すと押しても何も起きない。
 * 2026-08-30 に #399 で表示条件を「非 idle すべて」に広げたとき、これを巻き込んだ。
 */

/**
 * cc-bridge が「別セッションへ届けた」ことを示す status。
 * ★ agent-server の `emitCcAck` (`webhook/ccQueue.mts`) と対。**片方だけ変えると壊れる。**
 */
export const RELAYED_STATUS = 'relayed';

/**
 * この status のとき中断ボタンを出してよいか。
 *
 * ★ 知らない status は **出す側に倒す**。中断できるものを取りこぼす方が、
 *   押しても効かないボタンが出るより困る (= 走っている処理を止められない)。
 *   ★★ 逆に「中断できないもの」は増えるたびにここへ足す。増えたことに気づける形にしておく。
 */
export function isCancellableStatus(status: string): boolean {
  if (!status) return false;
  if (status === 'idle') return false;
  if (status === RELAYED_STATUS) return false;
  return true;
}
