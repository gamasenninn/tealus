/**
 * 接続の記録に添える端末の印 (2026-10-23 改善ループ 11 回目)
 *
 * ★ 1 人が端末を何台も持つ (通知の宛先 7 本の人がいる)。接続の記録に名前しか無いと、
 *   短い接続を繰り返しているのがどの端末か分からなかった。UA と通り方だけ添える (IP は CF の中継なので添えない)
 */
export function clientLabel(handshake: { headers: Record<string, string | string[] | undefined> }, transport: string | undefined): string {
  const raw = handshake.headers['user-agent'];
  const ua = (Array.isArray(raw) ? raw[0] : raw) || '';
  const clipped = (ua.length > 120 ? ua.slice(0, 120) + '…' : ua).replace(/\s+/g, ' ') || '-';
  return `transport=${transport || '-'} ua=${clipped}`;
}
