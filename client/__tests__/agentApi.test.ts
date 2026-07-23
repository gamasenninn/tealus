/**
 * #344 候補5: agent-api 4 メソッドを _agentApi に集約するリファクタの回帰網。
 * _agentApi の新能力 (as:blob / fallback / errorMessage) と、公開メソッドの
 * 振る舞い保存 (getCcProjects/getAgentIdentity は silent fallback、cancelAgent/
 * synthesizeTts は throw、synthesizeTts は blob) を固定する。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { api } from '../src/services/api';

const jsonRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const blobRes = (status: number, body: Blob) => ({ ok: status >= 200 && status < 300, status, blob: async () => body });

describe('_agentApi (集約ヘルパー)', () => {
  beforeEach(() => { api.token = 'tok'; });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('json 成功: /agent-api 前置 + Bearer で叩き body を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api._agentApi('GET', '/x')).resolves.toEqual({ ok: 1 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/agent-api/x');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('body 付きは Content-Type json + JSON 本文', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await api._agentApi('POST', '/y', { a: 1 });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('!ok は既定メッセージで throw、server の error を優先', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(500, { error: 'サーバー都合' })));
    await expect(api._agentApi('GET', '/x')).rejects.toThrow('サーバー都合');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(500, {})));
    await expect(api._agentApi('GET', '/x')).rejects.toThrow('agent-server リクエストに失敗しました');
  });

  it('errorMessage 指定で既定文言を差し替え', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(500, {})));
    await expect(api._agentApi('POST', '/tts', {}, { errorMessage: 'TTS に失敗しました' })).rejects.toThrow('TTS に失敗しました');
  });

  it('fallback 指定時は !ok でも throw せず fallback を返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(500, {})));
    await expect(api._agentApi('GET', '/x', undefined, { fallback: { projects: [] } })).resolves.toEqual({ projects: [] });
  });

  it('fallback 指定時はネットワーク断でも fallback を返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api._agentApi('GET', '/x', undefined, { fallback: { user_id: null } })).resolves.toEqual({ user_id: null });
  });

  it('as:blob で res.blob() を返す', async () => {
    const b = new Blob(['x']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(blobRes(200, b)));
    await expect(api._agentApi('POST', '/tts', {}, { as: 'blob' })).resolves.toBe(b);
  });
});

describe('agent-api 公開メソッド (振る舞い保存)', () => {
  beforeEach(() => { api.token = 'tok'; });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('getCcProjects: 成功は body、!ok は {projects:[]} に silent fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, { projects: [{ name: 'organon' }] })));
    await expect(api.getCcProjects()).resolves.toEqual({ projects: [{ name: 'organon' }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(404, {})));
    await expect(api.getCcProjects()).resolves.toEqual({ projects: [] });
  });

  it('getAgentIdentity: !ok / ネットワーク断は {user_id:null, display_name:null}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('net')));
    await expect(api.getAgentIdentity()).resolves.toEqual({ user_id: null, display_name: null });
  });

  it('synthesizeTts: 成功は Blob、!ok は「TTS に失敗しました」', async () => {
    const b = new Blob(['audio']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(blobRes(200, b)));
    await expect(api.synthesizeTts('hi', 'r1')).resolves.toBe(b);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(500, {})));
    await expect(api.synthesizeTts('hi', 'r1')).rejects.toThrow('TTS に失敗しました');
  });

  it('cancelAgent: !ok は「中断リクエストに失敗しました」', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(500, {})));
    await expect(api.cancelAgent('r1')).rejects.toThrow('中断リクエストに失敗しました');
  });
});
