/**
 * #476 日付へ飛ぶカレンダー
 * ★ 投稿のある日だけ押せる (空振りさせない)。月は前後に動かせるが、今月より先へは進めない
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMessageDays = vi.fn();
vi.mock('../../src/services/api', () => ({
  api: { getMessageDays: (roomId: string, month: string) => getMessageDays(roomId, month) },
}));

import DateJumpCalendar from '../../src/components/chat/DateJumpCalendar';

describe('DateJumpCalendar (#476)', () => {
  beforeEach(() => {
    getMessageDays.mockReset();
    getMessageDays.mockImplementation(async (_r: string, month: string) =>
      ({ days: month === '2026-09' ? ['2026-09-03', '2026-09-12'] : month === '2026-08' ? ['2026-08-31'] : [] }));
  });

  const open = (onPick = vi.fn(), onClose = vi.fn()) => {
    render(<DateJumpCalendar roomId="room1" initialDate="2026-09-12" today="2026-09-29" onPick={onPick} onClose={onClose} />);
    return { onPick, onClose };
  };
  const dayButton = (d: number) => screen.getByRole('button', { name: `${d}日` });

  it('★ 押した日の月を開き、投稿のある日だけ押せる', async () => {
    open();
    expect(screen.getByText('2026年9月')).toBeTruthy();
    await waitFor(() => expect((dayButton(12) as HTMLButtonElement).disabled).toBe(false));
    expect((dayButton(3) as HTMLButtonElement).disabled).toBe(false);
    expect((dayButton(4) as HTMLButtonElement).disabled).toBe(true);
    expect(getMessageDays).toHaveBeenCalledWith('room1', '2026-09');
  });

  it('★ 日を押すと、その日付を返す', async () => {
    const { onPick } = open();
    await waitFor(() => expect((dayButton(3) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dayButton(3));
    expect(onPick).toHaveBeenCalledWith('2026-09-03');
  });

  it('前の月へ動かすと、その月の投稿のある日を取りに行く', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '前の月' }));
    expect(screen.getByText('2026年8月')).toBeTruthy();
    await waitFor(() => expect((dayButton(31) as HTMLButtonElement).disabled).toBe(false));
    expect(getMessageDays).toHaveBeenLastCalledWith('room1', '2026-08');
  });

  it('★ 今月より先へは進めない', async () => {
    open();
    expect((screen.getByRole('button', { name: '次の月' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('閉じるボタンで閉じる', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('1 日の曜日の位置を合わせる (2026-09-01 は火曜 = 先頭に空きが 2 つ)', () => {
    open();
    expect(document.querySelectorAll('.date-jump-grid .date-jump-blank').length).toBe(2);
  });
});
