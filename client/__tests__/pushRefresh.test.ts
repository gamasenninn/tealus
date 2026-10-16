/**
 * 画面が表に出たときに通知の宛先を送り直す (2026-10-16、改善ループ 7 回目の 3)
 *
 * ★ 送り直しはログインと最初の読み込みのときだけだった。iPhone のアプリのように裏に残ったまま再開すると
 *   送り直さず、本体の「最後に送り直した時刻」が使っている人でも 2 週間以上古くなっていた (10-10 に読んでいる人が 09-27)。
 *   30 日送り直されない宛先を外す掃除 (本体) の前提になる。
 * ★★ 許可を求めない・新しい宛先を作らない。許可済みで、端末に宛先がすでにあるときだけ送る
 *   (画面に戻るたびに許可の確認が出ると困る)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribePush = vi.fn();
vi.mock('../src/services/api', () => ({ api: { subscribePush: (b: unknown) => subscribePush(b) } }));
vi.mock('../src/services/clientConfig', () => ({ getConfig: () => ({ vapid_public_key: 'AAAA' }) }));

import { refreshPushSubscription, PUSH_REFRESH_KEY } from '../src/services/pushNotification';

const sub = { endpoint: 'https://fcm.example/x', getKey: () => new Uint8Array([1, 2, 3]).buffer };
const subscribe = vi.fn();
let current: typeof sub | null = sub;
const requestPermission = vi.fn();

function setPermission(p: string) {
  Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: p, requestPermission } });
}

describe('refreshPushSubscription', () => {
  beforeEach(() => {
    subscribePush.mockReset().mockResolvedValue({});
    subscribe.mockReset();
    requestPermission.mockReset();
    current = sub;
    localStorage.clear();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => current, subscribe } }) },
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    setPermission('granted');
  });

  it('★ 許可済みで宛先があれば、同じ宛先を送り直す', async () => {
    expect(await refreshPushSubscription(1_000_000)).toBe(true);
    expect(subscribePush).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://fcm.example/x' }));
  });

  it('★ 6 時間以内にもう一度呼んでも送らない (間引く)', async () => {
    await refreshPushSubscription(1_000_000);
    expect(await refreshPushSubscription(1_000_000 + 5 * 3_600_000)).toBe(false);
    expect(await refreshPushSubscription(1_000_000 + 7 * 3_600_000)).toBe(true);
    expect(subscribePush).toHaveBeenCalledTimes(2);
  });

  it('force なら間引かない (プロフィールの「登録し直す」)', async () => {
    await refreshPushSubscription(1_000_000);
    expect(await refreshPushSubscription(1_000_001, { force: true })).toBe(true);
  });

  it('★★ 許可を求めない・新しい宛先を作らない', async () => {
    setPermission('default');
    expect(await refreshPushSubscription(1_000_000)).toBe(false);
    current = null;
    setPermission('granted');
    expect(await refreshPushSubscription(1_000_000)).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(subscribePush).not.toHaveBeenCalled();
  });

  it('送れなかったら時刻を進めない (次に表に出たときにもう一度)', async () => {
    subscribePush.mockRejectedValueOnce(new Error('offline'));
    expect(await refreshPushSubscription(1_000_000)).toBe(false);
    expect(localStorage.getItem(PUSH_REFRESH_KEY)).toBeNull();
    expect(await refreshPushSubscription(1_000_001)).toBe(true);
  });

  it('端末の保存領域が使えなくても送る (間引けないだけ)', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(await refreshPushSubscription(1_000_000)).toBe(true);
    spy.mockRestore();
  });
});
