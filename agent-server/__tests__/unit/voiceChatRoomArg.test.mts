/**
 * #477 会話モード: AI が room_id を写し間違え、「権限がない」と答えた
 *
 * ★ AI は list_rooms の 36 文字の ID を写してから道具を呼ぶ。2026-09-29 に 2 つの部屋の ID を
 *   前後でつないだ ID を作り、本体の 403「メンバーではありません」を「権限がない」と受け取った。
 * ★ いまの部屋は "current" で指せるようにする。参加していない ID は呼ばずに正直に返す。
 * ★★ 間違った ID を黙って今の部屋に置き換えない (別の部屋のつもりなら、違う部屋の中身で答えてしまう)
 */
import { describe, expect, test } from '@jest/globals';
import { resolveRoomArg, roomIdsFromListRooms } from '../../src/lib/voiceChatRoomArg.mts';

const CUR = 'f3ee3f54-e7f2-424d-b481-5b0028921026';
const OTHER = 'ff58c92a-d0df-4e22-af48-6fe52c807110';
const MIXED = 'f3ee3f54-e7f2-424d-b481-6fe52c807110';   // 実際に AI が作った ID
const known = new Set([CUR, OTHER]);

describe('resolveRoomArg', () => {
  test('★ "current" をいまの部屋の ID に置き換える', () => {
    const r = resolveRoomArg('get_messages', { room_id: 'current', limit: 50 }, CUR, '通話履歴', known);
    expect(r).toEqual({ ok: true, args: { room_id: CUR, limit: 50 } });
  });

  test('★★ 参加していない ID は呼ばずに返す (写し間違いの実例)', () => {
    const r = resolveRoomArg('get_messages', { room_id: MIXED }, CUR, '通話履歴', known);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.output).toContain(MIXED);
      expect(r.output).toContain('参加しているルームにありません');
      expect(r.output).toContain('current');
      expect(r.output).toContain('通話履歴');
    }
  });

  test('参加している別の部屋は、そのまま通す', () => {
    expect(resolveRoomArg('get_messages', { room_id: OTHER }, CUR, '通話履歴', known))
      .toEqual({ ok: true, args: { room_id: OTHER } });
  });

  test('いまの部屋の ID をそのまま渡されたら通す', () => {
    expect(resolveRoomArg('get_messages', { room_id: CUR }, CUR, '通話履歴', known))
      .toEqual({ ok: true, args: { room_id: CUR } });
  });

  test('★ join_room は参加していない部屋に入る道具なので、確かめない', () => {
    expect(resolveRoomArg('join_room', { room_id: MIXED }, CUR, '通話履歴', known).ok).toBe(true);
  });

  test('★ 一覧が無い (引けなかった) ときは確かめずに通す (止めない)', () => {
    expect(resolveRoomArg('get_messages', { room_id: MIXED }, CUR, '通話履歴', null).ok).toBe(true);
  });

  test('★ 一覧が無くても "current" は置き換える', () => {
    expect(resolveRoomArg('get_messages', { room_id: 'current' }, CUR, '通話履歴', null))
      .toEqual({ ok: true, args: { room_id: CUR } });
  });

  test('room_id が無い道具はそのまま', () => {
    expect(resolveRoomArg('search_messages', { q: '見積' }, CUR, '通話履歴', known))
      .toEqual({ ok: true, args: { q: '見積' } });
  });
});

describe('roomIdsFromListRooms — list_rooms の結果から参加しているルームの ID を取り出す', () => {
  test('MCP の text に JSON で入っている形', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ rooms: [{ id: CUR, name: '通話履歴' }, { id: OTHER, name: 'AI班連絡' }] }) }] };
    expect(roomIdsFromListRooms(result)).toEqual(new Set([CUR, OTHER]));
  });

  test('配列だけが入っている形', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify([{ id: CUR }]) }] };
    expect(roomIdsFromListRooms(result)).toEqual(new Set([CUR]));
  });

  test('★ 読めなければ null (確かめられない = 止めない側に倒す)', () => {
    expect(roomIdsFromListRooms({ content: [{ type: 'text', text: 'エラーです' }] })).toBeNull();
    expect(roomIdsFromListRooms(undefined)).toBeNull();
    expect(roomIdsFromListRooms({ content: [{ type: 'text', text: '{"rooms":[]}' }] })).toBeNull();
  });
});
