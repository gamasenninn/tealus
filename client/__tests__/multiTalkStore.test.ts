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

/**
 * docs/16 §5.1 (11-27) マルチトークの右の帯にタスク一覧。開いているかと幅は覚えておく (端末ごと)
 */
describe('useMultiTalkStore — タスクの帯 (docs/16 §5.1)', () => {
  beforeEach(() => {
    localStorage.removeItem('multiTalkTasksOpen');
    localStorage.removeItem('multiTalkTasksWidth');
    useMultiTalkStore.setState({ tasksOpen: false, tasksWidth: 360 });
  });

  it('★ toggleTasks で出す / 隠す。覚えておく', () => {
    useMultiTalkStore.getState().toggleTasks();
    expect(useMultiTalkStore.getState().tasksOpen).toBe(true);
    expect(localStorage.getItem('multiTalkTasksOpen')).toBe('1');
    useMultiTalkStore.getState().toggleTasks();
    expect(useMultiTalkStore.getState().tasksOpen).toBe(false);
    expect(localStorage.getItem('multiTalkTasksOpen')).toBe('0');
  });

  it('★ 幅は 300〜640 に収めて覚えておく', () => {
    useMultiTalkStore.getState().setTasksWidth(500);
    expect(useMultiTalkStore.getState().tasksWidth).toBe(500);
    expect(localStorage.getItem('multiTalkTasksWidth')).toBe('500');
    useMultiTalkStore.getState().setTasksWidth(100);
    expect(useMultiTalkStore.getState().tasksWidth).toBe(300);
    useMultiTalkStore.getState().setTasksWidth(2000);
    expect(useMultiTalkStore.getState().tasksWidth).toBe(640);
  });
});
