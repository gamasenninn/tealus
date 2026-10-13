/**
 * #600 本体が断った失敗には status を載せる (403 外された / 404 消された を、圏外と見分けるため)
 *
 * ★ 以前は GET の失敗は文だけで、status が無かった。覚えた部屋の中身を捨てるか残すかを決められない
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../src/services/api';

const jsonRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('api — 失敗に status を載せる (#600)', () => {
  beforeEach(() => { api.retryBackoffMs = [0, 0]; api.requestTimeoutMs = 50; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('★★ 403 は文と status の両方を持つ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(403, { error: 'このルームへのアクセス権がありません' })));
    const err = await api.request('GET', '/rooms/x').catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/アクセス権/);
    expect((err as { status?: number }).status).toBe(403);
  });

  it('★ JSON でない応答の失敗にも status を載せる', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error('x'); } }));
    const err = await api.request('GET', '/rooms/x').catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(404);
  });
});
