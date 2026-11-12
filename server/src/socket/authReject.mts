/**
 * socket の認証で断った理由のログの 1 行 (改善ループ 47、2026-11-12)。
 *
 * ★ 鍵 (JWT 7 日) の期限切れが本体に見えるのは「次に REST を呼んだときの 401」だけで、
 *   socket の再接続で断った分は記録されていなかった。週 1 回の入り直しを数えると過少になる
 *   (11-06 の小川さんは 401 が無く、socket で落ちたと推測するしかなかった)。
 * ★ 利用者は鍵の中身から読む (署名は確かめていない = 「未検証」と書く)。鍵そのものは出さない
 */
import jwt from 'jsonwebtoken';

export function socketAuthRejectLine(err: unknown, token: string, client: string): string {
  const name = err instanceof Error ? err.name : '';
  const decoded = jwt.decode(token) as { id?: unknown; exp?: unknown } | null;
  const who = typeof decoded?.id === 'string' ? decoded.id.slice(0, 8) : '?';
  const reason = name === 'TokenExpiredError' ? '期限切れ' : '無効';
  const exp = typeof decoded?.exp === 'number'
    ? ` 期限=${new Date(decoded.exp * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
    : '';
  return `[socket] 認証を断りました: ${reason} user=${who} (未検証)${exp}${client ? ` ${client}` : ''}`;
}
