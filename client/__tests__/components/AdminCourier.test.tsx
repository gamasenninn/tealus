/**
 * 管理画面「AIの班」(2026-11-20 利用者判断「A でつくって」、docs/12 §7)
 * ★ 配達役の鼓動を班ごとに並べる: 班 / 状態 (日本語) / 新着 / いつから。problem は上に目立たせる
 * ★ 鼓動が 5 分以上来ていなければ「配達役が止まっているかもしれない」と出す (古い一覧を今の様子と読ませない)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const api = vi.hoisted(() => ({ getAdminCourier: vi.fn() }));
vi.mock('../../src/services/api', () => ({ api }));

import CourierStatus from '../../src/components/admin/CourierStatus';

const NOW = new Date('2026-11-20T01:00:00Z').getTime();

describe('AIの班', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('★ 班ごとに状態を日本語で、新着と「いつから」を並べる。problem を上に出す', async () => {
    api.getAdminCourier.mockResolvedValue({ couriers: [{
      user_id: 'c1', display_name: '配達役', last_seen: new Date(NOW - 30_000).toISOString(),
      info: {
        bridges: {
          lp: { state: 'idle', pending: 0, since: new Date(NOW - 3 * 3600_000).toISOString() },
          ontology: { state: 'blocked', pending: 2, since: new Date(NOW - 12 * 60_000).toISOString() },
        },
        problem: 'ontology が確認待ちのまま 12 分 (新着 2 件)',
      },
    }] });
    render(<CourierStatus />);
    expect(await screen.findByText('ontology')).toBeTruthy();
    expect(screen.getByText('待っている')).toBeTruthy();
    expect(screen.getByText('確認待ち')).toBeTruthy();
    expect(screen.getByText('12 分前から')).toBeTruthy();
    expect(screen.getByText('3 時間前から')).toBeTruthy();
    expect(screen.getByText(/ontology が確認待ちのまま 12 分/)).toBeTruthy();
  });

  it('★ 鼓動が 5 分以上来ていなければ、配達役が止まっているかもしれないと出す', async () => {
    api.getAdminCourier.mockResolvedValue({ couriers: [{
      user_id: 'c1', display_name: '配達役', last_seen: new Date(NOW - 8 * 60_000).toISOString(),
      info: { bridges: { lp: { state: 'idle', pending: 0 } } },
    }] });
    render(<CourierStatus />);
    expect(await screen.findByText(/配達役が止まっているかもしれません/)).toBeTruthy();
  });

  it('配達役の鼓動がまだ無ければ、そう書く', async () => {
    api.getAdminCourier.mockResolvedValue({ couriers: [] });
    render(<CourierStatus />);
    expect(await screen.findByText(/配達役の鼓動がまだありません/)).toBeTruthy();
  });
});
