/**
 * トーク一覧のタブ「お客様」(2026-11-13 小野さん判断、docs/02 users.is_external_contact)
 * ★ お客様の部屋 = 社外の窓口の口座がいる (has_external_contact) か、ゲストがいる (has_guest) 部屋
 * ★ 窓口のいる部屋は「すべて」「1:1」「グループ」に出さない (増えると埋まる)。ゲストが 1 人いるだけの社内の部屋はほかのタブにも出す
 * ★ タブはお客様の部屋が 1 つ以上ある人にだけ出す。選んだタブを覚える
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { roomTabs, filterRoomsByTab, loadRoomTab, saveRoomTab } from '../src/utils/roomTabs';

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
