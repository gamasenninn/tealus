/**
 * 鼓動を本体へ送る (docs/12 §7・§12.6、docs/09 §3.2)。口座は配達役専用の機械の口座 (2026-11-19 利用者)。
 * ★ 資格情報は ~/.tealus/courier/auth.json (repo の外)。ここでは受け取るだけ
 * ★ ログインの鍵は使い回し、401 のときだけ 1 回取り直す (listen-tealus の #427 と同じ)
 * ★ 失敗しても投げない (鼓動が送れなくても配達は止めない)。送れたかを返す
 */
export interface CourierAuth { api_url: string; login_id: string; password: string }

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ status: number; json: () => Promise<unknown> }>;

export function heartbeatSender(auth: CourierAuth, fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike) {
  let token: string | null = null;
  const login = async (): Promise<string | null> => {
    const r = await fetchImpl(`${auth.api_url}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_id: auth.login_id, password: auth.password }), signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json()) as { token?: unknown };
    return r.status === 200 && typeof j.token === 'string' ? j.token : null;
  };
  const post = (info: Record<string, unknown>) => fetchImpl(`${auth.api_url}/api/bot/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'courier', info }),
    signal: AbortSignal.timeout(10_000),
  });
  return async function send(info: Record<string, unknown>): Promise<boolean> {
    try {
      if (!token) token = await login();
      if (!token) return false;
      let r = await post(info);
      if (r.status === 401) {
        token = await login();
        if (!token) return false;
        r = await post(info);
      }
      return r.status >= 200 && r.status < 300;
    } catch {
      return false;
    }
  };
}
