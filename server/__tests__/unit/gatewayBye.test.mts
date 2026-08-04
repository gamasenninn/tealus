/**
 * #368 停止時に agent-server へ「中継が落ちる」を伝える (段 2 の本体サーバ側)。
 *
 * ★ secret / fetch を注入で受け取るので、この test は **DB にもネットワークにも触れない**
 *   (middleware/auth.mts を import すると db/pool.mts が芋づるで読み込まれるため、
 *    JWT_SECRET は呼び出し側から渡す設計にしてある)。
 */
import jwt from 'jsonwebtoken';
import { notifyGatewayBye } from '../../src/utils/gatewayBye.mts';

const SECRET = 'test-secret-for-gateway-bye';

interface Captured { url: string; init: RequestInit }

function okFetch(notified = 1): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ notified }) };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('notifyGatewayBye — agent-server への一段渡し (#368)', () => {
  test('agent-server の gateway-bye に POST する', async () => {
    const { fetchImpl, calls } = okFetch(2);
    const notified = await notifyGatewayBye({ port: 4000, secret: SECRET, expectBackMs: 30000, fetchImpl });

    expect(notified).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:4000/cc-queue/gateway-bye');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ expect_back_ms: 30000 });
  });

  test('★ 共有 JWT を Authorization に載せる (送信元アドレスでは守れないため)', async () => {
    const { fetchImpl, calls } = okFetch();
    await notifyGatewayBye({ port: 4000, secret: SECRET, expectBackMs: 30000, fetchImpl });

    const auth = (calls[0].init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Bearer /);
    const decoded = jwt.verify(auth.slice(7), SECRET) as { exp: number; iat: number };
    // ★ 停止処理の中でしか使わないので短命にする
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(60);
  });

  test('AGENT_PORT を反映する', async () => {
    const { fetchImpl, calls } = okFetch();
    await notifyGatewayBye({ port: '4321', secret: SECRET, expectBackMs: 1000, fetchImpl });
    expect(calls[0].url).toBe('http://localhost:4321/cc-queue/gateway-bye');
  });

  test('★ 非 2xx は throw する (呼び出し側が warn に出せるように)', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(notifyGatewayBye({ port: 4000, secret: SECRET, expectBackMs: 30000, fetchImpl }))
      .rejects.toThrow(/401/);
  });

  test('★ agent-server が落ちていれば throw する (停止処理側で握りつぶす契約)', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(notifyGatewayBye({ port: 4000, secret: SECRET, expectBackMs: 30000, fetchImpl }))
      .rejects.toThrow(/ECONNREFUSED/);
  });

  test('★ 応答が返らなくても打ち切る (停止を人質に取らせない)', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      // 実装が渡した AbortSignal で中断されることを確認する
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;

    await expect(notifyGatewayBye({ port: 4000, secret: SECRET, expectBackMs: 30000, timeoutMs: 20, fetchImpl }))
      .rejects.toThrow();
  });
});
