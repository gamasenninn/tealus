/**
 * アプリパネルの状態 (useAppPanel)
 *
 * ★ 改善ループ 61: 部屋を移った直後は、画面の部屋 (URL の roomId) が先に変わり、部屋の中身 (currentRoom) は
 *   取り終わるまで前の部屋のまま。その間、前の部屋のアプリが新しい部屋の番号で開かれ、通行証の口に
 *   「その部屋に無いアプリ」を頼んで 404 になり、元の URL (ベーシック認証の箱が出る方) で開いていた。
 *   2026-11-16 11:56 に本番で 1 回 (EC 管理 → 業務メモ。[app-pass] 出さない: その番号のアプリが無い)
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppPanel } from '../../src/hooks/useAppPanel';
import type { Room } from '../../src/types';

const EC = { id: 'room-ec', app_urls: [{ title: 'EC 管理', url: 'https://shop.example.com/admin/', pass: true, auto_open: true }] } as unknown as Room;
const MEMO = { id: 'room-memo', app_urls: [] } as unknown as Room;

describe('useAppPanel', () => {
  it('部屋の中身が今の部屋なら、そのアプリを並べる', () => {
    const { result } = renderHook(() => useAppPanel(EC, 'room-ec'));
    expect(result.current.appUrls).toHaveLength(1);
    expect(result.current.showAppPanel).toBe(true);   // auto_open
  });

  it('★ 部屋を移った直後 (中身がまだ前の部屋) は、前の部屋のアプリを並べない', () => {
    const { result, rerender } = renderHook(({ room, id }) => useAppPanel(room, id), {
      initialProps: { room: EC, id: 'room-ec' },
    });
    expect(result.current.appUrls).toHaveLength(1);
    rerender({ room: EC, id: 'room-memo' });          // URL だけ先に変わった
    expect(result.current.appUrls).toEqual([]);
    rerender({ room: MEMO, id: 'room-memo' });        // 中身が届いた
    expect(result.current.appUrls).toEqual([]);
  });

  it('部屋の中身がまだ無い (null) なら、何も並べない', () => {
    const { result } = renderHook(() => useAppPanel(null, 'room-ec'));
    expect(result.current.appUrls).toEqual([]);
  });
});
