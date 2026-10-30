/**
 * 起動時に設定 (/api/config) を取れなかった端末は、ログインが通ったところで取り直す (2026-10-30 改善ループ 26 回目)
 *
 * ★ 25 回目で「起動の確かめ (initialize)」には入れたが、パスワードを入れる道 (login) と、
 *   通話・トランシーバーの表示 (capability) には届いていなかった
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/pushNotification', () => ({
  registerPushNotification: vi.fn(), pushPermission: () => 'default',
  startPushResumeRefresh: vi.fn(), unregisterPushNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/services/socket', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn() }));

const fetchMock = vi.fn()
  .mockRejectedValueOnce(new Error('offline'))   // 起動時 (main.tsx) は圏外
  .mockResolvedValue({ ok: true, json: async () => ({ vapid_public_key: 'K', realtime_voice_available: true }) });
vi.stubGlobal('fetch', fetchMock);

const { loadConfig, getConfig } = await import('../src/services/clientConfig');
const { api } = await import('../src/services/api');
const { useAuthStore } = await import('../src/stores/authStore');
const { useCapabilityStore } = await import('../src/stores/capabilityStore');

describe('ログインで設定を取り直す', () => {
  it('★★ 圏外で開いてからログインしても、通知の鍵と通話の表示が入る', async () => {
    await loadConfig();
    expect(getConfig().vapid_public_key).toBe('');
    vi.spyOn(api, 'login').mockResolvedValue({ token: 't', user: { id: 'u1', notification_sound: true } } as never);
    await useAuthStore.getState().login('EMP001', 'password1');
    expect(getConfig().vapid_public_key).toBe('K');
    expect(useCapabilityStore.getState().realtimeVoiceAvailable).toBe(true);
  });

  it('設定の取得には時間切れが付いている (届かない道で「読み込み中」のまま止めない)', () => {
    const init = fetchMock.mock.calls.find(([url]) => url === '/api/config')?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
