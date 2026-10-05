/**
 * #502 左の一覧 (RoomList) とマルチトーク (MultiTalk) の受け渡し
 * ★ 一覧は DesktopShell の中、パネルは MultiTalk の中にあり、親子ではない。
 *   「開いて」を店に置き、MultiTalk が受け取る (messageStore の pendingAgentMessage と同じ形)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMultiTalkStore, roomClickAction } from '../src/stores/multiTalkStore';

describe('roomClickAction — 一覧で部屋を押したとき (#502)', () => {
  it('★ /multi ではパネルを開く', () => {
    expect(roomClickAction('/multi')).toBe('panel');
  });
  it('★ ほかの画面では今までどおり部屋へ移る', () => {
    expect(roomClickAction('/talk')).toBe('navigate');
    expect(roomClickAction('/rooms/r-1')).toBe('navigate');
    expect(roomClickAction('/')).toBe('navigate');
  });
});

describe('useMultiTalkStore (#502)', () => {
  beforeEach(() => { useMultiTalkStore.setState({ pendingOpen: null, openRoomIds: [], sidebarHidden: false }); });

  it('★ requestOpen → takeOpen で 1 回だけ受け取れる', () => {
    useMultiTalkStore.getState().requestOpen({ id: 'r1', name: 'A' });
    expect(useMultiTalkStore.getState().takeOpen()).toEqual({ id: 'r1', name: 'A' });
    expect(useMultiTalkStore.getState().takeOpen()).toBeNull();
  });

  it('開いている部屋の一覧を持つ (一覧の印に使う)', () => {
    useMultiTalkStore.getState().setOpenRoomIds(['r1', 'r2']);
    expect(useMultiTalkStore.getState().openRoomIds).toEqual(['r1', 'r2']);
  });

  it('一覧を隠す / 出す', () => {
    useMultiTalkStore.getState().toggleSidebar();
    expect(useMultiTalkStore.getState().sidebarHidden).toBe(true);
    useMultiTalkStore.getState().toggleSidebar();
    expect(useMultiTalkStore.getState().sidebarHidden).toBe(false);
  });
});
