/**
 * アプリパネルの状態 (useAppPanel)
 *
 * ★ 改善ループ 61: 部屋を移った直後は、画面の部屋 (URL の roomId) が先に変わり、部屋の中身 (currentRoom) は
 *   取り終わるまで前の部屋のまま。その間、前の部屋のアプリが新しい部屋の番号で開かれ、通行証の口に
 *   「その部屋に無いアプリ」を頼んで 404 になり、元の URL (ベーシック認証の箱が出る方) で開いていた。
 *   2026-11-16 11:56 に本番で 1 回 (EC 管理 → 業務メモ。[app-pass] 出さない: その番号のアプリが無い)
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

  /**
   * ★ 改善ループ 62: パソコンの 2 列の画面では、部屋を移ってもトーク画面は作り直されない (App.tsx の Route に key が無い)。
   *   開いたまま・選んだ番号のまま次の部屋に持ち越し、自動で開かない部屋でもアプリが開き、
   *   番号が次の部屋のアプリの数を超えると、どのタブも選ばれていない空の枠が出ていた
   */
  it('★ 部屋を移ったら、開いた状態と選んだ番号を持ち越さない (自動で開く印が無ければ閉じる)', () => {
    const MULTI = { id: 'room-multi', app_urls: [{ title: 'a', url: 'https://a.example/' }, { title: 'b', url: 'https://b.example/' }] } as unknown as Room;
    const PLAIN = { id: 'room-plain', app_urls: [{ title: 'c', url: 'https://c.example/' }] } as unknown as Room;
    const { result, rerender } = renderHook(({ room, id }) => useAppPanel(room, id), {
      initialProps: { room: MULTI, id: 'room-multi' },
    });
    act(() => { result.current.setActiveAppIndex(1); result.current.setShowAppPanel(true); });
    rerender({ room: MULTI, id: 'room-plain' });
    rerender({ room: PLAIN, id: 'room-plain' });
    expect(result.current.showAppPanel).toBe(false);
    expect(result.current.activeAppIndex).toBe(0);
  });

  it('★ 移った先に自動で開く印があれば、その番号で開く', () => {
    const { result, rerender } = renderHook(({ room, id }) => useAppPanel(room, id), {
      initialProps: { room: MEMO, id: 'room-memo' },
    });
    expect(result.current.showAppPanel).toBe(false);
    rerender({ room: MEMO, id: 'room-ec' });
    rerender({ room: EC, id: 'room-ec' });
    expect(result.current.showAppPanel).toBe(true);
    expect(result.current.activeAppIndex).toBe(0);
  });

  it('同じ部屋の中身を読み直しても (同じ id)、開いた状態は変えない', () => {
    const { result, rerender } = renderHook(({ room, id }) => useAppPanel(room, id), {
      initialProps: { room: MEMO, id: 'room-memo' },
    });
    act(() => { result.current.setShowAppPanel(true); });
    rerender({ room: { ...MEMO } as Room, id: 'room-memo' });
    expect(result.current.showAppPanel).toBe(true);
  });

  it('部屋の中身がまだ無い (null) なら、何も並べない', () => {
    const { result } = renderHook(() => useAppPanel(null, 'room-ec'));
    expect(result.current.appUrls).toEqual([]);
  });
});
