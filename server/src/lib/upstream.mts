/**
 * #556 本体が呼ぶ相手 (agent-server / rtc-server / MCP HTTP) の宛先を 1 か所で決める。
 *
 * ★ 以前はどれも `http://localhost:<port>` の固定で、docker-compose.full.yml のように別コンテナで動かすと届かなかった
 *   (/agent-api の中継・設定の取得・通話の稼働確認・停止の予告)。
 * ★ `AGENT_URL` などが設定されていればそれを使う。未設定なら今までどおり localhost + ポート (1 台で動かす人は何もしなくてよい)。
 * ★ 呼ぶたびに env を読む (テストで差し替えられるように。数回/分の呼び出しなので気にしない)
 */
const trim = (u: string) => u.replace(/\/+$/, '');

export function agentUrl(): string {
  return process.env.AGENT_URL ? trim(process.env.AGENT_URL) : `http://localhost:${process.env.AGENT_PORT || 4000}`;
}

export function rtcUrl(): string {
  return process.env.RTC_URL ? trim(process.env.RTC_URL) : `http://localhost:${process.env.RTC_PORT || 3100}`;
}

export function mcpHttpUrl(): string {
  return process.env.MCP_HTTP_URL ? trim(process.env.MCP_HTTP_URL) : `http://localhost:${process.env.MCP_HTTP_PORT || 3200}`;
}
