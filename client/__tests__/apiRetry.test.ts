import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../src/services/api';

// #322: transport 層の間欠失敗（Cloudflare↔オリジン↔回線のストール）に対する
// client 耐性。GET のみ transient 失敗を限定リトライ + 全 method にタイムアウト。
// POST/PUT/DELETE は二重送信回避のためリトライしない。

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
// 非JSON応答（プロキシの HTML エラーページ等）を模す: json() が throw する
const htmlRes = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new SyntaxError('Unexpected token <'); },
});

describe('api.request 耐性 (#322)', () => {
  beforeEach(() => {
    api.token = null;
    api.retryBackoffMs = [0, 0]; // テスト高速化（本番は [300, 800]）
    api.requestTimeoutMs = 50;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('GET は 503 で 1 度リトライし、次の 200 で成功する', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes(503, { error: 'busy' }))
      .mockResolvedValueOnce(jsonRes(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.request('GET', '/rooms')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GET はネットワーク断(TypeError)でリトライし回復する', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonRes(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.request('GET', '/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GET はタイムアウト(AbortError)でリトライし回復する', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce(jsonRes(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.request('GET', '/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GET は 404 ではリトライせず即エラー（サーバーのメッセージを保持）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(404, { error: 'ルームが見つかりません' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.request('GET', '/rooms/x')).rejects.toThrow('ルームが見つかりません');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POST は 503 でもリトライしない（二重送信回避）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(503, { error: 'busy' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.request('POST', '/rooms/x/messages', { content: 'hi' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GET は持続的 502 でリトライ上限（計3回）後にエラー', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(502, { error: 'bad gateway' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.request('GET', '/rooms')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('GET は非JSON応答(502)をリトライし、回復後 200 を返す', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(htmlRes(502))
      .mockResolvedValueOnce(jsonRes(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.request('GET', '/rooms')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
