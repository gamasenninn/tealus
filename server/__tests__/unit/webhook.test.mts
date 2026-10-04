/**
 * Webhook Dispatcher ユニットテスト
 * リトライ・署名生成のロジックテスト
 */
import crypto from 'node:crypto';

/** mock fetch response の指定形式 (= { ok, status } or { throw }) */
interface MockFetchSpec {
  ok?: boolean;
  status?: number;
  throw?: string;
}

// fetch をモック
const originalFetch = global.fetch;
let mockFetchResponses: MockFetchSpec[] = [];
let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetchResponses = [];
  mockFetch = jest.fn(async () => {
    const response = mockFetchResponses.shift();
    if (response?.throw) throw new Error(response.throw);
    return { ok: response?.ok ?? true, status: response?.status ?? 200 };
  });
  global.fetch = mockFetch as unknown as typeof global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// pool をモック（DB不要）
jest.mock('../../src/db/pool.mts', () => ({ pool: {
  query: jest.fn(),
} }));

import { dispatchWithRetry, generateSignature, fireWebhooks } from '../../src/services/webhook.mts';

describe('generateSignature', () => {
  test('HMAC-SHA256署名を生成する', () => {
    const sig = generateSignature('my-secret', '{"test":true}');
    const expected = crypto.createHmac('sha256', 'my-secret').update('{"test":true}').digest('hex');
    expect(sig).toBe(expected);
  });
});

describe('dispatchWithRetry', () => {
  test('成功時は1回で完了', async () => {
    mockFetchResponses = [{ ok: true, status: 200 }];

    const result = await dispatchWithRetry(
      { url: 'http://example.com/hook', secret: null },
      '{}',
      { maxRetries: 3, baseDelay: 10 }
    );

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('1回失敗→2回目で成功（リトライ）', async () => {
    mockFetchResponses = [
      { ok: false, status: 500 },
      { ok: true, status: 200 },
    ];

    const result = await dispatchWithRetry(
      { url: 'http://example.com/hook', secret: null },
      '{}',
      { maxRetries: 3, baseDelay: 10 }
    );

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('全リトライ失敗→最終結果を返す', async () => {
    mockFetchResponses = [
      { ok: false, status: 500 },
      { ok: false, status: 502 },
      { ok: false, status: 503 },
    ];

    const result = await dispatchWithRetry(
      { url: 'http://example.com/hook', secret: null },
      '{}',
      { maxRetries: 3, baseDelay: 10 }
    );

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test('ネットワークエラー時もリトライする', async () => {
    mockFetchResponses = [
      { throw: 'ECONNREFUSED' },
      { ok: true, status: 200 },
    ];

    const result = await dispatchWithRetry(
      { url: 'http://example.com/hook', secret: null },
      '{}',
      { maxRetries: 3, baseDelay: 10 }
    );

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  test('署名ヘッダーが付与される', async () => {
    mockFetchResponses = [{ ok: true, status: 200 }];

    await dispatchWithRetry(
      { url: 'http://example.com/hook', secret: 'test-secret' },
      '{"data":"hello"}',
      { maxRetries: 1, baseDelay: 10 }
    );

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['X-Tealus-Signature']).toMatch(/^sha256=[a-f0-9]+$/);
  });

  test('4xx エラーはリトライしない（クライアントエラー）', async () => {
    mockFetchResponses = [
      { ok: false, status: 404 },
    ];

    const result = await dispatchWithRetry(
      { url: 'http://example.com/hook', secret: null },
      '{}',
      { maxRetries: 3, baseDelay: 10 }
    );

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ★ #491 送り主の権限を載せる。受け手 (agent-server) がゲストの便を見分けるため。
//   送り主の形を作る所は 10 か所あるので、送る入口の 1 か所で引く
describe('fireWebhooks — 送り主の権限 (#491)', () => {
  const { pool } = jest.requireMock('../../src/db/pool.mts') as { pool: { query: jest.Mock } };

  function routeQueries(role: string | null) {
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM webhooks')) return { rows: [{ id: 'w1', url: 'http://hook.test/x', secret: null }] };
      if (sql.includes('FROM users')) return { rows: role ? [{ role }] : [] };
      return { rows: [] };
    });
  }
  const sentBody = () => JSON.parse(String((mockFetch.mock.calls[0] as unknown[])[1] && ((mockFetch.mock.calls[0] as unknown[])[1] as { body: string }).body));

  beforeEach(() => { pool.query.mockReset(); });

  it('★★ message.sender に role が載る', async () => {
    routeQueries('guest');
    mockFetchResponses = [{ ok: true, status: 200 }];
    await fireWebhooks('message.created', 'r1', { message: { id: 'm1', sender: { id: 'g1', display_name: '外の人' } } });
    await new Promise((r) => setTimeout(r, 20));
    expect(sentBody().message.sender).toEqual({ id: 'g1', display_name: '外の人', role: 'guest' });
  });

  it('送り主の無い payload はそのまま (落ちない)', async () => {
    routeQueries('user');
    mockFetchResponses = [{ ok: true, status: 200 }];
    await fireWebhooks('member.joined', 'r1', { user: { id: 'u1' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(sentBody().user).toEqual({ id: 'u1' });
  });
});
