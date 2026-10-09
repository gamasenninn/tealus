/**
 * #539 ログインの期限 (7 日) が切れたら、ログイン画面へ案内する
 *
 * ★ 以前は 401 を特別扱いせず、「ルーム一覧の取得に失敗しました」の帯だけが出て、
 *   アプリを完全に閉じて開き直すまでログイン画面に戻らなかった
 * ★ ログインしている状態 (トークンあり) で 401 が返ったら onUnauthorized を呼ぶ。
 *   ログイン画面での打ち間違い (/auth/login の 401) では呼ばない
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../src/services/api';

const jsonRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('api — 認証が切れたとき (#539)', () => {
  const onUnauthorized = vi.fn();
  beforeEach(() => {
    onUnauthorized.mockReset();
    api.setOnUnauthorized(onUnauthorized);
    api.retryBackoffMs = [0, 0];
    api.requestTimeoutMs = 50;
  });
  afterEach(() => { vi.unstubAllGlobals(); api.token = null; });

  it('★★ ログイン中に 401 が返ったら知らせる (エラーは今までどおり投げる)', async () => {
    api.token = 'expired';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(401, { error: 'トークンが無効です' })));
    await expect(api.request('GET', '/rooms')).rejects.toThrow(/トークンが無効/);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('★ ログイン画面の打ち間違い (/auth/login の 401) では知らせない', async () => {
    api.token = null;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(401, { error: 'IDまたはパスワードが違います' })));
    await expect(api.request('POST', '/auth/login', { login_id: 'x', password: 'y' })).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('トークンが無い (ログインしていない) なら知らせない', async () => {
    api.token = null;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(401, { error: '認証が必要です' })));
    await expect(api.request('GET', '/rooms')).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('403 (権限が無い) では知らせない (ログインは切れていない)', async () => {
    api.token = 't';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(403, { error: 'メンバーのみ' })));
    await expect(api.request('GET', '/rooms/x')).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
