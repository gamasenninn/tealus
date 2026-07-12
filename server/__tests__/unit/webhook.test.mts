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

import { dispatchWithRetry, generateSignature } from '../../src/services/webhook.mts';

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
