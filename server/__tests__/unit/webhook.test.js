/**
 * Webhook Dispatcher ユニットテスト
 * リトライ・署名生成のロジックテスト
 */
const crypto = require('crypto');

// fetch をモック
const originalFetch = global.fetch;
let mockFetchResponses = [];

beforeEach(() => {
  mockFetchResponses = [];
  global.fetch = jest.fn(async () => {
    const response = mockFetchResponses.shift();
    if (response?.throw) throw new Error(response.throw);
    return { ok: response?.ok ?? true, status: response?.status ?? 200 };
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

// pool をモック（DB不要）
jest.mock('../../src/db/pool', () => ({
  query: jest.fn(),
}));

const { dispatchWithRetry, generateSignature } = require('../../src/services/webhook');

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
    expect(global.fetch).toHaveBeenCalledTimes(1);
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
    expect(global.fetch).toHaveBeenCalledTimes(2);
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
    expect(global.fetch).toHaveBeenCalledTimes(3);
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

    const callArgs = global.fetch.mock.calls[0];
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
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
