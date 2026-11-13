/**
 * トーク一覧のタブ (2026-11-13 小野さん判断「お客様の部屋のタブ」、docs/02 users.is_external_contact)。
 *
 * ★ お客様の部屋 = 社外の窓口の口座がいる (has_external_contact) か、ゲストがいる (has_guest) 部屋。
 *   EC サイトのお客様の発言は窓口の口座が代わりに投稿するので、お客様本人の口座は部屋にいない
 * ★ 窓口のいる部屋は「すべて」「1:1」「グループ」に出さない (増えると埋まるので、専用のタブだけで見る)。
 *   ゲストが 1 人いるだけの社内の部屋は、今までどおりほかのタブにも出す
 * ★ 「お客様」のタブは、お客様の部屋が 1 つ以上ある人にだけ出す (ほかの社員の画面は変わらない)
 */

export type RoomTabKey = 'all' | 'direct' | 'group' | 'customer';

interface TabRoom {
  type: string;
  unread_count?: number;
  has_external_contact?: boolean;
  has_guest?: boolean;
}

export interface RoomTab { key: RoomTabKey; label: string; unreadRooms?: number }

const BASE_TABS: RoomTab[] = [
  { key: 'all', label: 'すべて' },
  { key: 'direct', label: '1:1 ルーム' },
  { key: 'group', label: 'グループ' },
];

export function isCustomerRoom(r: TabRoom): boolean {
  return !!r.has_external_contact || !!r.has_guest;
}

export function filterRoomsByTab<T extends TabRoom>(rooms: T[], tab: string): T[] {
  if (tab === 'customer') return rooms.filter(isCustomerRoom);
  const visible = rooms.filter((r) => !r.has_external_contact);
  return tab === 'all' ? visible : visible.filter((r) => r.type === tab);
}

/** 出すタブ。「お客様」には未読のある部屋の数を添える (中身は「新着あり」。返事が要る数ではない) */
export function roomTabs(rooms: TabRoom[]): RoomTab[] {
  const customer = rooms.filter(isCustomerRoom);
  if (customer.length === 0) return BASE_TABS;
  return [...BASE_TABS, { key: 'customer', label: 'お客様', unreadRooms: customer.filter((r) => (r.unread_count ?? 0) > 0).length }];
}

const STORAGE_KEY = 'roomListTab';

/** 覚えたタブ。今は出ていないタブ・覚えていない・読めないときは「すべて」 */
export function loadRoomTab(available: string[]): RoomTabKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && available.includes(v)) return v as RoomTabKey;
  } catch { /* 使えない環境 (プライベートモードなど) は覚えない */ }
  return 'all';
}

export function saveRoomTab(tab: string): void {
  try { localStorage.setItem(STORAGE_KEY, tab); } catch { /* 覚えられなくても動く */ }
}
