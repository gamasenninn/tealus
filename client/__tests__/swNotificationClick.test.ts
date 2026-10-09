/**
 * #544 通知をタップしたときに開く窓 (public/custom-sw.js の notificationclick)
 *
 * ★ 以前は開いている窓の一覧の「最初の 1 つ」を移していた。一覧にはマルチトークのパネルの中の画面 (iframe) も入るので、
 *   パネルの中が通常の画面に切り替わることがあった。移すのに失敗すると新しい窓も開かず、タップしても何も起きなかった
 * ★ 今: パネルの中 (frameType: nested) は選ばず、本体の窓だけ。見えている窓を優先。失敗したら新しい窓で開く
 */
import { describe, it, expect, vi } from 'vitest';
// ★ ファイルは Vite の ?raw で文字として読む (画面の型検査は Node の型を持たないので node:fs を使わない)
import swCode from '../public/custom-sw.js?raw';

type Win = { url: string; frameType: string; visibilityState: string; navigate: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> };
const win = (over: Partial<Win> = {}): Win => {
  const w: Win = {
    url: 'http://x/talk', frameType: 'top-level', visibilityState: 'hidden',
    navigate: vi.fn(async () => w), focus: vi.fn(async () => w), ...over,
  };
  return w;
};

/** SW のファイルを偽の self / clients で読み込み、notificationclick を 1 回送る */
async function clickNotification(list: Win[], roomId = 'r-1') {
  const listeners: Record<string, (e: unknown) => void> = {};
  const clients = { matchAll: vi.fn(async () => list), openWindow: vi.fn(async () => null) };
  const self = { addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; }, navigator: {}, registration: {} };
  new Function('self', 'clients', 'caches', swCode)(self, clients, {});
  let done: Promise<unknown> = Promise.resolve();
  listeners.notificationclick({ notification: { close: vi.fn(), data: { roomId } }, waitUntil: (p: Promise<unknown>) => { done = p; } });
  await done;
  return clients;
}

describe('notificationclick (#544)', () => {
  it('★★ マルチトークのパネルの中 (nested) は選ばず、本体の窓を移す', async () => {
    const panel = win({ frameType: 'nested', url: 'http://x/rooms/r-9?embed=true' });
    const top = win();
    await clickNotification([panel, top]);
    expect(panel.navigate).not.toHaveBeenCalled();
    expect(top.navigate).toHaveBeenCalledWith('/rooms/r-1');
  });

  it('★ 見えている窓を優先する', async () => {
    const hidden = win({ visibilityState: 'hidden' });
    const visible = win({ visibilityState: 'visible' });
    await clickNotification([hidden, visible]);
    expect(visible.navigate).toHaveBeenCalled();
    expect(hidden.navigate).not.toHaveBeenCalled();
  });

  it('★★ 移すのに失敗したら、新しい窓で開く (何も起きない、にしない)', async () => {
    const broken = win({ navigate: vi.fn(async () => { throw new Error('uncontrolled'); }) });
    const clients = await clickNotification([broken]);
    expect(clients.openWindow).toHaveBeenCalledWith('/rooms/r-1');
  });

  it('窓が無ければ新しい窓で開く', async () => {
    const clients = await clickNotification([]);
    expect(clients.openWindow).toHaveBeenCalledWith('/rooms/r-1');
  });

  it('パネルの中しか無ければ、新しい窓で開く', async () => {
    const panel = win({ frameType: 'nested' });
    const clients = await clickNotification([panel]);
    expect(panel.navigate).not.toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledWith('/rooms/r-1');
  });
});
