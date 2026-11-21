/**
 * 本体へログインした鍵で呼ぶ (鼓動・段階 3 の便の取り寄せ、docs/12 §7・§14)。
 * ★ 資格情報は ~/.tealus/courier/auth.json (repo の外)。ここでは受け取るだけ
 * ★ ログインの鍵は使い回し、401 のときだけ 1 回取り直す (listen-tealus の #427 と同じ)。2 回目も 401 なら諦めて返す
 * ★ 投げない。つながらないときは status 0 と理由を返す
 */
export interface CourierAuth { api_url: string; login_id: string; password: string }

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ status: number; json: () => Promise<unknown> }>;

export type AuthedResult = { status: number; body: unknown; error?: string };

export function authClient(auth: CourierAuth, fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike) {
  let token: string | null = null;
  const login = async (): Promise<string | null> => {
    const r = await fetchImpl(`${auth.api_url}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_id: auth.login_id, password: auth.password }), signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json()) as { token?: unknown };
    return r.status === 200 && typeof j.token === 'string' ? j.token : null;
  };
  const once = async (method: string, url: string, body?: unknown) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    let parsed: unknown = null;
    try { parsed = await r.json(); } catch { /* 本文が JSON でない (proxy のエラーなど) */ }
    return { status: r.status, body: parsed };
  };
  return async function call(method: string, path: string, body?: unknown): Promise<AuthedResult> {
    try {
      if (!token) token = await login();
      if (!token) return { status: 401, body: null, error: 'ログインできません' };
      let r = await once(method, `${auth.api_url}${path}`, body);
      if (r.status === 401) {
        token = await login();
        if (!token) return { status: 401, body: null, error: 'ログインできません' };
        r = await once(method, `${auth.api_url}${path}`, body);
      }
      return r;
    } catch (err) {
      return { status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
    }
  };
}
