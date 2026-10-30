/**
 * ホームのお知らせを、開いたままでも取り直す (2026-10-30 小野さん判断 11)
 * ★ 以前は開いたときに 1 回読むだけで、開いている間・通信が戻ったあとに来たお知らせは、開き直すまで出なかった
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type Handler = (data?: unknown) => void;
const fakeSocket = vi.hoisted(() => ({
  handlers: {} as Record<string, Handler[]>,
  on(e: string, h: Handler) { (this.handlers[e] ||= []).push(h); },
  off(e: string, h: Handler) { this.handlers[e] = (this.handlers[e] || []).filter((x) => x !== h); },
  trigger(e: string, d?: unknown) { (this.handlers[e] || []).forEach((h) => h(d)); },
}));
vi.mock('../../src/services/socket', () => ({ getSocket: () => fakeSocket }));
const api = vi.hoisted(() => ({
  getAnnouncements: vi.fn(async () => ({ messages: [] })),
  getPortalLinks: vi.fn(async () => ({ links: [] })),
  markRead: vi.fn(async () => ({})),
}));
vi.mock('../../src/services/api', () => ({ api }));
vi.mock('../../src/components/common/BottomNav', () => ({ default: () => null }));

import HomePage from '../../src/components/home/HomePage';

describe('ホームのお知らせの取り直し', () => {
  beforeEach(() => { vi.useFakeTimers(); fakeSocket.handlers = {}; api.getAnnouncements.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  const mount = async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(api.getAnnouncements).toHaveBeenCalledTimes(1);
  };

  it('★★ 画面に戻ったとき取り直す', async () => {
    await mount();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(1000); });
    expect(api.getAnnouncements).toHaveBeenCalledTimes(2);
  });

  it('★★ つなぎ直したとき・お知らせが公開されたとき取り直す (続けて来ても 1 回にまとめる)', async () => {
    await mount();
    await act(async () => {
      fakeSocket.trigger('connect');
      fakeSocket.trigger('message:published', { message_id: 'm1', room_id: 'r1', is_published: true });
      vi.advanceTimersByTime(1000);
    });
    expect(api.getAnnouncements).toHaveBeenCalledTimes(2);
  });
});
