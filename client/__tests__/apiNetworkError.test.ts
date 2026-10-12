import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../src/services/api';

// ★ 期待する文はここに直接書く (api から import すると、まだ無いときに undefined になり toThrow(undefined) が何でも通す)
const NETWORK_ERROR_MESSAGE = 'つながっていません。電波を確かめて、もう一度お試しください';
const TIMEOUT_ERROR_MESSAGE = '時間がかかりすぎました。電波を確かめて、もう一度お試しください';

/**
 * #592 電波が切れたとき、画面に英語 (Failed to fetch / Load failed / signal is aborted) をそのまま出さない。
 * ★ 通り道 (request / _agentApi / _upload) で日本語の案内に置き換える。30 か所以上の画面がこれを通る
 */
const abortErr = () => Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' });

describe('#592 通信の失敗を日本語の案内に', () => {
  beforeEach(() => {
    api.token = 'tok';
    api.retryBackoffMs = [0, 0];
    api.requestTimeoutMs = 50;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('★ POST でつながらない (TypeError) → 「つながっていません…」', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.request('POST', '/x', {})).rejects.toThrow(NETWORK_ERROR_MESSAGE);
  });

  it('★ POST の時間切れ (AbortError) → 「時間がかかりすぎました…」', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr()));
    await expect(api.request('PUT', '/x', {})).rejects.toThrow(TIMEOUT_ERROR_MESSAGE);
  });

  it('★ GET はリトライし尽くしたら、つながらない → 日本語', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')));
    await expect(api.request('GET', '/x')).rejects.toThrow(NETWORK_ERROR_MESSAGE);
  });

  it('★ GET の時間切れも ms 表記でなく日本語', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr()));
    await expect(api.request('GET', '/x')).rejects.toThrow(TIMEOUT_ERROR_MESSAGE);
  });

  it('サーバが断ったときの文 (日本語) はそのまま', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: '権限がありません' }) }));
    await expect(api.request('POST', '/x', {})).rejects.toThrow('権限がありません');
  });

  it('★ AI の部屋の設定 (_agentApi) でつながらない → 日本語', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api._agentApi('GET', '/config/x')).rejects.toThrow(NETWORK_ERROR_MESSAGE);
  });
});

describe('#592 添付の送信 (_upload)', () => {
  class FakeXhr {
    static last: FakeXhr;
    status = 0; responseText = '';
    upload = { onprogress: null as unknown };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open() {} setRequestHeader() {}
    send() { FakeXhr.last = this; }
  }
  beforeEach(() => { vi.stubGlobal('XMLHttpRequest', FakeXhr); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('★ 通信が切れたら「つながっていません…」', async () => {
    const p = api._upload('/u', new FormData());
    FakeXhr.last.onerror!();
    await expect(p).rejects.toThrow(NETWORK_ERROR_MESSAGE);
  });

  it('★ JSON でない応答 (プロキシの HTML) でも決着する (以前は送信中のまま止まった)', async () => {
    const p = api._upload('/u', new FormData());
    FakeXhr.last.status = 413;
    FakeXhr.last.responseText = '<html>413 Request Entity Too Large</html>';
    FakeXhr.last.onload!();
    await expect(p).rejects.toThrow('送れませんでした (応答 413)');
  });
});
