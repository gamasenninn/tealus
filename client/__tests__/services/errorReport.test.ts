/**
 * #525 画面のエラーを本体のログへ送る。
 * ★ 以前は利用者の端末で起きたエラーがどこにも残らなかった。
 * ★ 投稿の本文は送らない: 送るのは種類・メッセージ・場所・画面のパス・ビルド ID だけ。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/stores/authStore', () => ({ useAuthStore: { getState: () => ({ token: 'tok' }) } }));

const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(null, { status: 204 })));
vi.stubGlobal('fetch', fetchMock);

async function load() {
  vi.resetModules();
  return import('../../src/services/errorReport');
}
const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

describe('reportClientError', () => {
  beforeEach(() => fetchMock.mockClear());

  it('種類・メッセージ・場所・パスを /api/client-errors へ送る (トークンがあれば添える)', async () => {
    const { reportClientError } = await load();
    const err = new Error('Cannot read properties of undefined');
    reportClientError('render', err, 'at ChatRoom\n at App');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    if (!init) throw new Error('init が無い');
    expect(url).toBe('/api/client-errors');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const body = sentBodies()[0];
    expect(body.kind).toBe('render');
    expect(body.message).toBe('Cannot read properties of undefined');
    expect(body.stack).toMatch(/ChatRoom/);
    expect(body.path).toBe(window.location.pathname);
    expect(Object.keys(body).sort()).toEqual(['build', 'kind', 'message', 'path', 'stack']);
  });

  it('★ 同じエラーは 1 回だけ送る (描画のたびに同じものが出ても溢れない)', async () => {
    const { reportClientError } = await load();
    for (let i = 0; i < 5; i++) reportClientError('error', new Error('same'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('★ 1 回の読み込みで最大 10 件', async () => {
    const { reportClientError } = await load();
    for (let i = 0; i < 20; i++) reportClientError('error', new Error(`e${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('Error でない値 (Promise の失敗の理由など) も文字にして送る', async () => {
    const { reportClientError } = await load();
    reportClientError('unhandledrejection', { code: 42 });
    expect(sentBodies()[0].message).toMatch(/42/);
  });

  it('★ 送るのに失敗しても例外を投げない (記録のせいで画面を止めない)', async () => {
    const { reportClientError } = await load();
    fetchMock.mockImplementationOnce(() => { throw new Error('offline'); });
    expect(() => reportClientError('error', new Error('x'))).not.toThrow();
  });

  it('window の error と unhandledrejection を拾う', async () => {
    const { installGlobalErrorHandlers } = await load();
    installGlobalErrorHandlers();
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('global boom'), message: 'global boom' }));
    const ev = new Event('unhandledrejection') as Event & { reason?: unknown };
    ev.reason = new Error('promise boom');
    window.dispatchEvent(ev);
    const kinds = sentBodies().map((b) => `${b.kind}:${b.message}`);
    expect(kinds).toContain('error:global boom');
    expect(kinds).toContain('unhandledrejection:promise boom');
  });
});
