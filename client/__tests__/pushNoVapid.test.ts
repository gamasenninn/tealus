/**
 * 通知の鍵 (VAPID) が無い Tealus では、プロフィールの「この端末で通知を受け取る」を出さない (2026-10-29)
 * ★ 採用者が鍵を設定していないと、押すたびに「少し待ってから、もう一度押してください」と出て、待っても直らなかった
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/clientConfig', () => ({ getConfig: () => ({ vapid_public_key: '' }) }));
vi.mock('../src/services/api', () => ({ api: {} }));

describe('getPushState — 鍵の無い Tealus', () => {
  it('★ unsupported を返す (ボタンを出さない)', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => undefined } });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
    const { getPushState } = await import('../src/services/pushNotification');
    await expect(getPushState()).resolves.toBe('unsupported');
  });
});
