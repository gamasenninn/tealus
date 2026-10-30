/**
 * 起動時に /api/config を取れなかったら、あとで取り直せる (2026-10-30 改善ループ 25 回目)
 *
 * ★ 失敗したときの代わりの値 (通知の鍵が空) を覚えてしまい、電波が戻っても起動し直すまで
 *   通知の帯も登録も出なかった (圏外で開いた新しい端末)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('clientConfig', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

  it('★★ 取れなかったときの代わりの値は覚えず、次の loadConfig で取り直す', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ vapid_public_key: 'K' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { loadConfig, getConfig } = await import('../src/services/clientConfig');
    expect((await loadConfig()).vapid_public_key).toBe('');
    expect((await loadConfig()).vapid_public_key).toBe('K');
    expect(getConfig().vapid_public_key).toBe('K');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('取れた値は覚える (2 回目は取りに行かない)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ vapid_public_key: 'K' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { loadConfig } = await import('../src/services/clientConfig');
    await loadConfig(); await loadConfig();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('clientConfig — 古いブラウザ', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

  // ★ AbortSignal.timeout は iOS 15 以前・Chrome 102 以前に無い。使うと fetch の前に同期で投げ、main.tsx の描画まで届かない (真っ白)
  it('★★ AbortSignal.timeout が無くても取れる', async () => {
    const orig = AbortSignal.timeout;
    (AbortSignal as unknown as { timeout?: unknown }).timeout = undefined;
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ vapid_public_key: 'K' }) }));
      const { loadConfig } = await import('../src/services/clientConfig');
      expect((await loadConfig()).vapid_public_key).toBe('K');
    } finally { (AbortSignal as unknown as { timeout: unknown }).timeout = orig; }
  });
});
