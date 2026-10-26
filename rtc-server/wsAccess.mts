/**
 * 通話・トランシーバーの入口 (/ws) の守り (2026-10-26 小野さん判断、セキュリティチェックループの D)。
 * ★ 以前は鍵が無くても「名無し」で入れ、部屋のメンバーかも見ていなかった。
 *   通話の画面は単独のページなので、部屋の ID さえ分かれば、ログインしていない人・部屋から外れた人でも入れた
 */
import type http from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-ray', 'cf-connecting-ip'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 鍵なしで入れてよいのは、同じマシンから直接つないだものだけ (agent-server の古い読み上げの送り、TTS_BROADCAST_MEDIASOUP)。
 * ★ 本体の中継 (/rtc) も同じマシンから来るが、外からの要求には Cloudflare・NAS が付けた見出しが残っているので分けられる
 */
export function isLocalUnproxied(req: http.IncomingMessage): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return false;
  return !PROXY_HEADERS.some((h) => req.headers[h] !== undefined);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** その部屋のメンバーかを、本人の鍵で本体に聞く (GET /api/rooms/:id はメンバーにだけ 200)。届かなければ断る */
export async function checkRoomMember(apiUrl: string, token: string, roomId: string, fetchFn: FetchLike = fetch): Promise<boolean> {
  if (!UUID_RE.test(roomId)) return false;
  try {
    const res = await fetchFn(`${apiUrl}/api/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
