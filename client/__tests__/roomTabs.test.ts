/**
 * トーク一覧のタブ「お客様」(2026-11-13 小野さん判断、docs/02 users.is_external_contact)
 * ★ お客様の部屋 = 社外の窓口の口座が作って今もいる (has_external_contact、判定は本体) か、ゲストがいる (has_guest) 部屋
 * ★ 窓口のいる部屋は「すべて」「1:1」「グループ」に出さない (増えると埋まる)。ゲストが 1 人いるだけの社内の部屋はほかのタブにも出す
 * ★ タブはお客様の部屋が 1 つ以上ある人にだけ出す。選んだタブを覚える
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { roomTabs, filterRoomsByTab, hiddenRoomsInTab, loadRoomTab, saveRoomTab } from '../src/utils/roomTabs';

type R = { id: string; type: 'direct' | 'group'; unread_count?: number; has_external_contact?: boolean; has_guest?: boolean };
const ec: R = { id: 'ec', type: 'group', unread_count: 2, has_external_contact: true };
const ec2: R = { id: 'ec2', type: 'group', unread_count: 0, has_external_contact: true };
const guestGroup: R = { id: 'gg', type: 'group', unread_count: 1, has_guest: true };
const dm: R = { id: 'dm', type: 'direct' };
const grp: R = { id: 'g', type: 'group' };

describe('filterRoomsByTab', () => {
  const rooms = [ec, ec2, guestGroup, dm, grp];
  const ids = (rs: R[]) => rs.map((r) => r.id);

  it('★ 「お客様」は窓口のいる部屋とゲストのいる部屋', () => {
    expect(ids(filterRoomsByTab(rooms, 'customer'))).toEqual(['ec', 'ec2', 'gg']);
  });
  it('★ 窓口のいる部屋は「すべて」「グループ」に出さない。ゲストのいる社内の部屋は出す', () => {
    expect(ids(filterRoomsByTab(rooms, 'all'))).toEqual(['gg', 'dm', 'g']);
    expect(ids(filterRoomsByTab(rooms, 'group'))).toEqual(['gg', 'g']);
    expect(ids(filterRoomsByTab(rooms, 'direct'))).toEqual(['dm']);
  });
  it('印の無い古い本体の応答 (has_* が無い) では今までどおり', () => {
    expect(ids(filterRoomsByTab([dm, grp], 'all'))).toEqual(['dm', 'g']);
  });
});

describe('roomTabs', () => {
  it('★ お客様の部屋が 1 つ以上あれば「お客様」のタブを最後に足し、未読のある部屋の数を添える', () => {
    const tabs = roomTabs([ec, ec2, guestGroup, dm]);
    expect(tabs.map((t) => t.key)).toEqual(['all', 'direct', 'group', 'customer']);
    expect(tabs[3]).toMatchObject({ label: 'お客様', unreadRooms: 2 });
  });
  it('★ お客様の部屋が無い人にはタブを出さない', () => {
    expect(roomTabs([dm, grp]).map((t) => t.key)).toEqual(['all', 'direct', 'group']);
  });
});

describe('選んだタブを覚える', () => {
  beforeEach(() => localStorage.clear());
  it('★ 覚えたタブを読み出す', () => {
    saveRoomTab('customer');
    expect(loadRoomTab(['all', 'direct', 'group', 'customer'])).toBe('customer');
  });
  it('今は出ていないタブ (お客様の部屋が無くなった) は「すべて」に戻す', () => {
    saveRoomTab('customer');
    expect(loadRoomTab(['all', 'direct', 'group'])).toBe('all');
  });
  it('覚えていなければ「すべて」', () => {
    expect(loadRoomTab(['all', 'direct', 'group'])).toBe('all');
  });
});

// ★ #655 自分の一覧から隠した部屋 (is_hidden、判定は本体: 隠した後に新しい投稿があれば false = 自動で戻る)
describe('隠した部屋', () => {
  type H = { id: string; type: 'direct' | 'group'; unread_count?: number; has_external_contact?: boolean; is_hidden?: boolean };
  const g: H = { id: 'g', type: 'group' };
  const gHidden: H = { id: 'gh', type: 'group', is_hidden: true };
  const dHidden: H = { id: 'dh', type: 'direct', is_hidden: true };
  const ecHidden: H = { id: 'ech', type: 'group', has_external_contact: true, is_hidden: true, unread_count: 3 };

  it('★ どのタブでも隠した部屋は並びに出さない', () => {
    const rooms = [g, gHidden, dHidden, ecHidden];
    expect(filterRoomsByTab(rooms, 'all').map((r) => r.id)).toEqual(['g']);
    expect(filterRoomsByTab(rooms, 'direct')).toEqual([]);
    expect(filterRoomsByTab(rooms, 'customer')).toEqual([]);
  });

  it('★ 隠した部屋はそのタブに属するものだけ別に返す (一覧の下の「隠した部屋」に出す)', () => {
    const rooms = [g, gHidden, dHidden, ecHidden];
    expect(hiddenRoomsInTab(rooms, 'all').map((r) => r.id)).toEqual(['gh', 'dh']);
    expect(hiddenRoomsInTab(rooms, 'group').map((r) => r.id)).toEqual(['gh']);
    expect(hiddenRoomsInTab(rooms, 'customer').map((r) => r.id)).toEqual(['ech']);
  });

  it('「お客様」タブの未読の数に隠した部屋は入れない。お客様の部屋が隠したものだけでもタブは出す', () => {
    const tabs = roomTabs([g, ecHidden]);
    expect(tabs.map((t) => t.key)).toContain('customer');
    expect(tabs.find((t) => t.key === 'customer')!.unreadRooms).toBe(0);
  });
});
