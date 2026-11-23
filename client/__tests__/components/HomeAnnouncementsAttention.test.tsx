/**
 * 改善ループ 100 (2026-11-23): ホームのお知らせも、人が使っていない窓では既読にしない (#651 の同じ型の残り)
 * ★ 以前はお知らせを取り直すたびに未読を無条件で既読にしていた。2 枚目の画面や裏のタブにホームを出したままだと、
 *   届いたお知らせが 500ms 後に既読になり、スマホにも未読が出なかった
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/services/socket', () => ({ getSocket: () => null }));
const api = vi.hoisted(() => ({
  getAnnouncements: vi.fn(async () => ({ messages: [{ id: 'a1', room_id: 'r1', is_unread: true, content: 'x', created_at: '2026-11-23T00:00:00Z' }] })),
  getPortalLinks: vi.fn(async () => ({ links: [] })),
  markRead: vi.fn(async () => ({})),
}));
vi.mock('../../src/services/api', () => ({ api }));
vi.mock('../../src/components/common/BottomNav', () => ({ default: () => null }));
const att = vi.hoisted(() => ({ using: true, cbs: new Set<(a: boolean) => void>() }));
vi.mock('../../src/services/attention', () => ({
  isAttending: () => att.using,
  onAttentionChange: (cb: (a: boolean) => void) => { att.cbs.add(cb); return () => att.cbs.delete(cb); },
}));
const setUsing = (v: boolean) => { att.using = v; for (const cb of [...att.cbs]) cb(v); };

import HomePage from '../../src/components/home/HomePage';

describe('ホームのお知らせの既読は、人が使っているときだけ', () => {
  beforeEach(() => { api.markRead.mockClear(); att.cbs.clear(); att.using = true; });

  const mount = async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  };

  it('使っているときは今までどおり既読にする', async () => {
    await mount();
    expect(api.markRead).toHaveBeenCalledWith('r1', ['a1']);
  });

  it('★★ 使っていないときは既読にせず、使い始めたら既読にする', async () => {
    att.using = false;
    await mount();
    expect(api.markRead).not.toHaveBeenCalled();
    await act(async () => { setUsing(true); });
    expect(api.markRead).toHaveBeenCalledWith('r1', ['a1']);
    expect(api.markRead).toHaveBeenCalledTimes(1);
  });
});
