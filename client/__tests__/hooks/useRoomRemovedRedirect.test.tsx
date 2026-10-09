/**
 * #533 開いている部屋から外れたら、知らせを出してトークの一覧へ戻る
 * ★ マルチトークのパネル (embed) の中では移らない (パネルの中にトーク一覧が出てしまう)。知らせだけ
 */
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

const notify = vi.fn();
vi.mock('../../src/stores/confirmStore', () => ({ notify: (...a: unknown[]) => notify(...a) }));

import { useRoomRemovedRedirect } from '../../src/hooks/useRoomRemovedRedirect';

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/rooms/r-1']}>{children}</MemoryRouter>;
const fire = (roomId: string) => act(() => { window.dispatchEvent(new CustomEvent('tealus:room-removed', { detail: { room_id: roomId } })); });

describe('useRoomRemovedRedirect (#533)', () => {
  beforeEach(() => notify.mockClear());

  it('★★ 開いている部屋なら、知らせを出してトークの一覧へ移る', () => {
    const { result } = renderHook(() => { useRoomRemovedRedirect('r-1', false); return useLocation(); }, { wrapper });
    fire('r-1');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(result.current.pathname).toBe('/talk');
  });

  it('別の部屋なら何もしない', () => {
    const { result } = renderHook(() => { useRoomRemovedRedirect('r-1', false); return useLocation(); }, { wrapper });
    fire('r-other');
    expect(notify).not.toHaveBeenCalled();
    expect(result.current.pathname).toBe('/rooms/r-1');
  });

  it('★ マルチトークのパネルの中では移らない (知らせだけ)', () => {
    const { result } = renderHook(() => { useRoomRemovedRedirect('r-1', true); return useLocation(); }, { wrapper });
    fire('r-1');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(result.current.pathname).toBe('/rooms/r-1');
  });
});
