import { create } from 'zustand';

/**
 * #502 PC のマルチトーク: 左の一覧 (RoomList) と MultiTalk の受け渡し。
 *
 * ★ 一覧は DesktopShell の中、パネルは MultiTalk の中にあり、親子ではない。
 *   以前は MultiTalk が自前の一覧を持ち、「トーク」が 2 つ並んでいた (押した結果も違った)。
 *   一覧は RoomList 1 つにそろえ、`/multi` では「開いて」をここに置いて MultiTalk が受け取る
 *   (messageStore の pendingAgentMessage と同じ形)。
 */

/** パネルを開くのに要る部屋の情報 (RoomList の部屋の行から渡す) */
export interface MultiTalkRoomRef {
  id: string;
  name: string;
}

interface MultiTalkState {
  /** 一覧で押された、まだパネルになっていない部屋 */
  pendingOpen: MultiTalkRoomRef | null;
  /** パネルで開いている部屋 (一覧の「開いている」印に使う) */
  openRoomIds: string[];
  /** `/multi` で左の一覧を隠しているか (パネルを広く使う)。ほかの画面では効かない */
  sidebarHidden: boolean;
  requestOpen: (room: MultiTalkRoomRef) => void;
  /** 受け取ったら消す (1 回だけ開く) */
  takeOpen: () => MultiTalkRoomRef | null;
  setOpenRoomIds: (ids: string[]) => void;
  toggleSidebar: () => void;
}

export const useMultiTalkStore = create<MultiTalkState>()((set, get) => ({
  pendingOpen: null,
  openRoomIds: [],
  sidebarHidden: false,
  requestOpen: (room) => set({ pendingOpen: room }),
  takeOpen: () => {
    const room = get().pendingOpen;
    if (room) set({ pendingOpen: null });
    return room;
  },
  setOpenRoomIds: (ids) => set({ openRoomIds: ids }),
  toggleSidebar: () => set((s) => ({ sidebarHidden: !s.sidebarHidden })),
}));

/** 一覧で部屋を押したときに何をするか。`/multi` ではパネルを開き、ほかでは部屋へ移る */
export function roomClickAction(pathname: string): 'panel' | 'navigate' {
  return pathname === '/multi' ? 'panel' : 'navigate';
}
