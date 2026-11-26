/**
 * 部屋の履歴 (GET /api/rooms/:id/messages) の SQL の組み立てと件数の丸め。改善ループ 128 で messages.mts の道から出した (中身は同じ)
 * ★ 出した前の 4 つの SQL をそのまま写して突き合わせる (空白だけ詰める)。DB での結果は結合テスト (messages など) が見ている
 */
import { buildRoomMessagesQuery, parseRoomMessagesLimit } from '../../src/services/roomMessagesQuery.mts';

const R = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

const HEAD = `SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               COALESCE(rc.read_count, 0)::int AS read_count
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS read_count
          FROM room_read_cursors rrc
          WHERE rrc.room_id = m.room_id AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
        ) rc ON true
        WHERE m.room_id = $1`;
// ★ #664 で around・before・基準なしの並びに id を足した (after と同じ (時刻, id) の組)。それ以外はループ 128 の前と同じ
const BEFORE_128 = {
  around: `${HEAD} AND m.created_at >= (SELECT created_at FROM messages WHERE id = $2 AND room_id = $1) - INTERVAL '1 second' ORDER BY m.created_at ASC, m.id ASC LIMIT $3`,
  after: `${HEAD} AND (m.created_at, m.id) > (SELECT created_at, id FROM messages WHERE id = $2 AND room_id = $1) ORDER BY m.created_at ASC, m.id ASC LIMIT $3`,
  before: `${HEAD} AND (m.created_at, m.id) < (SELECT created_at, id FROM messages WHERE id = $2 AND room_id = $1) ORDER BY m.created_at DESC, m.id DESC LIMIT $3`,
  latest: `${HEAD} ORDER BY m.created_at DESC, m.id DESC LIMIT $2`,
};

describe('parseRoomMessagesLimit', () => {
  it('無い・数でない・0 は既定 (20)、1〜50 に収める', () => {
    expect(parseRoomMessagesLimit(undefined)).toBe(20);
    expect(parseRoomMessagesLimit('abc')).toBe(20);
    expect(parseRoomMessagesLimit('0')).toBe(20);
    expect(parseRoomMessagesLimit('-3')).toBe(1);
    expect(parseRoomMessagesLimit('30')).toBe(30);
    expect(parseRoomMessagesLimit('51')).toBe(50);
  });
});

describe('buildRoomMessagesQuery (出す前の SQL と同じ)', () => {
  it('around: 基準の 1 秒前から古い順', () => {
    const q = buildRoomMessagesQuery({ roomId: R, around: C, limit: 9 });
    expect(squash(q.query)).toBe(squash(BEFORE_128.around));
    expect(q.params).toEqual([R, C, 9]);
  });
  it('after: (時刻, id) の組で新しいものを古い順 (#511)', () => {
    const q = buildRoomMessagesQuery({ roomId: R, after: C, limit: 9 });
    expect(squash(q.query)).toBe(squash(BEFORE_128.after));
    expect(q.params).toEqual([R, C, 9]);
  });
  it('before: 基準より古いものを新しい順', () => {
    const q = buildRoomMessagesQuery({ roomId: R, before: C, limit: 9 });
    expect(squash(q.query)).toBe(squash(BEFORE_128.before));
    expect(q.params).toEqual([R, C, 9]);
  });
  it('基準なし: 新しい順に limit 件 (limit は $2)', () => {
    const q = buildRoomMessagesQuery({ roomId: R, limit: 9 });
    expect(squash(q.query)).toBe(squash(BEFORE_128.latest));
    expect(q.params).toEqual([R, 9]);
  });
  it('基準が 2 つ以上なら around > after > before の順で 1 つだけ使う', () => {
    expect(buildRoomMessagesQuery({ roomId: R, around: C, after: 'x', before: 'y', limit: 1 }).params).toEqual([R, C, 1]);
    expect(buildRoomMessagesQuery({ roomId: R, after: C, before: 'y', limit: 1 }).params).toEqual([R, C, 1]);
  });
});
