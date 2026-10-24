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

  // ★ 改善ループ 10-13 の 5.: _agentApi だけ時間切れが無く、AI の部屋の設定が回り続けることがあった
  it('★ AI の部屋の設定 (_agentApi) も時間切れで止まり、日本語で返す', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) => new Promise((_res, rej) => {
      opts.signal?.addEventListener('abort', () => rej(abortErr()));
    })));
    await expect(api._agentApi('GET', '/config/x')).rejects.toThrow(TIMEOUT_ERROR_MESSAGE);
  });

  it('★ AI の部屋の設定 (_agentApi) でつながらない → 日本語', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api._agentApi('GET', '/config/x')).rejects.toThrow(NETWORK_ERROR_MESSAGE);
  });
});

// ★ 2026-10-23 小野さん判断 (改善ループ 12 回目の B7): 会話モードの開始は MCP の冷間起動を吸収するので数十秒かかることがある。
//   ふつうの 10 秒で切ると、電波のせいでないのに「時間がかかりすぎました」が出た
describe('会話モードの開始は 60 秒まで待つ', () => {
  beforeEach(() => { api.token = 'tok'; api.requestTimeoutMs = 50; });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('★ 開始 (session) はふつうの時間切れを越えても待つ', async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((resolve) => {
      init.signal?.addEventListener('abort', () => { aborted = true; });
      setTimeout(() => resolve(new Response(JSON.stringify({ session_id: 's', client_secret: 'c', model: 'm' }), { status: 200 })), 30_000);
    })));
    const p = api.createVoiceChatSession('r1');
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(p).resolves.toMatchObject({ session_id: 's' });
    expect(aborted).toBe(false);
  });

  it('60 秒を越えたら打ち切る', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const p = api.createVoiceChatSession('r1');
    const rejected = expect(p).rejects.toThrow(TIMEOUT_ERROR_MESSAGE);
    await vi.advanceTimersByTimeAsync(60_001);
    await rejected;
  });
});

// ★ 改善ループ 14 回目: 会話モードの道具 (サーバの MCP は 30 秒まで待つ) と読み上げの合成 (500 字で 33 秒の実例) も 10 秒で切っていた。
//   切ると画面は「失敗」とモデルに伝えるが、サーバでは実行が済む (send_message なら二重の芽)
describe('会話モードの道具・読み上げは長めに待つ', () => {
  beforeEach(() => { api.token = 'tok'; api.requestTimeoutMs = 50; });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const slowOk = (ms: number, body: BodyInit) => vi.fn((_u: string, init: RequestInit) => new Promise((resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    setTimeout(() => resolve(new Response(body, { status: 200 })), ms);
  }));

  it('★ 道具の呼び出しは 30 秒かかっても切らない', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', slowOk(30_000, JSON.stringify({ output: 'ok', elapsed_ms: 30000 })));
    const p = api.voiceChatToolCall('s', 'c', 'search_messages', '{}');
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(p).resolves.toMatchObject({ output: 'ok' });
  });

  it('★ 読み上げの合成は 40 秒かかっても切らない', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', slowOk(40_000, new Blob(['wav'])));
    const p = api.synthesizeTts('こんにちは', 'r1');
    await vi.advanceTimersByTimeAsync(40_001);
    await expect(p).resolves.toBeInstanceOf(Blob);
  });
});

describe('#592 添付の送信 (_upload)', () => {
  class FakeXhr {
    static last: FakeXhr;
    status = 0; responseText = '';
    upload = { onprogress: null as unknown, onload: null as unknown };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    aborted = false;
    open() {} setRequestHeader() {}
    send() { FakeXhr.last = this; }
    abort() { this.aborted = true; }
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

  // ★ 改善ループ 12 回目: 電波が途中で止まると「アップロード中… 37%」のまま、入力欄も＋もマイクも押せなくなった (時間切れが無かった)
  it('★ バイトが一定時間動かなければ打ち切り、「時間がかかりすぎました…」', async () => {
    vi.useFakeTimers();
    api.uploadStallMs = 1000;
    const p = api._upload('/u', new FormData(), () => {});
    const rejected = expect(p).rejects.toThrow(TIMEOUT_ERROR_MESSAGE);
    vi.advanceTimersByTime(1001);
    await rejected;
    expect(FakeXhr.last.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('動いている間は打ち切らない (進むたびに数え直す)', async () => {
    vi.useFakeTimers();
    api.uploadStallMs = 1000;
    const p = api._upload('/u', new FormData(), () => {});
    const x = FakeXhr.last as unknown as { upload: { onprogress: (e: unknown) => void } };
    for (let i = 1; i <= 3; i++) { vi.advanceTimersByTime(800); x.upload.onprogress({ lengthComputable: true, loaded: i, total: 4 }); }
    FakeXhr.last.status = 200; FakeXhr.last.responseText = '{"ok":true}'; FakeXhr.last.onload!();
    await expect(p).resolves.toEqual({ ok: true });
    expect(FakeXhr.last.aborted).toBe(false);
    vi.useRealTimers();
  });

  // ★ 改善ループ 13 回目: 送り終わった後 (サーバが動画のサムネイル等を作っている間) は onprogress が来ない。
  //   そこまで 60 秒で切ると、サーバでは投稿ができているのに失敗に見え、送り直して二重になる
  it('★ 送り終わった後は、応答を長く待つ (60 秒では切らない)', async () => {
    vi.useFakeTimers();
    api.uploadStallMs = 1000;
    api.uploadResponseWaitMs = 5000;
    const p = api._upload('/u', new FormData(), () => {});
    const x = FakeXhr.last as unknown as { upload: { onprogress: (e: unknown) => void; onload: () => void } };
    x.upload.onprogress({ lengthComputable: true, loaded: 4, total: 4 });
    x.upload.onload();
    vi.advanceTimersByTime(4000);
    expect(FakeXhr.last.aborted).toBe(false);
    FakeXhr.last.status = 201; FakeXhr.last.responseText = '{"ok":true}'; FakeXhr.last.onload!();
    await expect(p).resolves.toEqual({ ok: true });
    vi.useRealTimers();
  });

  it('送り終わった後も、応答がいつまでも来なければ打ち切る', async () => {
    vi.useFakeTimers();
    api.uploadStallMs = 1000;
    api.uploadResponseWaitMs = 5000;
    const p = api._upload('/u', new FormData(), () => {});
    const rejected = expect(p).rejects.toThrow(TIMEOUT_ERROR_MESSAGE);
    (FakeXhr.last as unknown as { upload: { onload: () => void } }).upload.onload();
    vi.advanceTimersByTime(5001);
    await rejected;
    vi.useRealTimers();
  });
});
