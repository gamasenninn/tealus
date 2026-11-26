/**
 * bot の未読 (GET /api/bot/unread) の SQL の組み立て。改善ループ 133 で bot.mts の道から出した (中身は同じ)
 * ★ 出す前の 2 つの SQL をそのまま写して突き合わせる (空白だけ詰める)。DB での結果は結合テスト (bot-api・unreadSinceJoin・botRequesterScope) が見ている
 */
import { buildBotUnreadQuery } from '../../src/services/botMessagesQuery.mts';

const U = '00000000-0000-0000-0000-0000000000aa';
const R = '00000000-0000-0000-0000-0000000000bb';
const Q = '00000000-0000-0000-0000-0000000000cc';
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const COND = 'EXISTS (SELECT 1 FROM room_members rq WHERE rq.room_id = m.room_id AND rq.user_id = $2)';

const HEAD = `SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at,
               u.display_name AS sender_display_name,
               r.name AS room_name, r.type AS room_type
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id`;
const BEFORE_133 = {
  room: `${HEAD}
        WHERE m.room_id = $1
          AND m.sender_id != $2
          AND m.is_deleted = false
          AND m.created_at > GREATEST(
            (SELECT last_read_at FROM room_read_cursors WHERE room_id = $1 AND user_id = $2),
            (SELECT joined_at FROM room_members WHERE room_id = $1 AND user_id = $2)
          )
        ORDER BY m.created_at ASC
        LIMIT 100`,
  all: `${HEAD}
        JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $1
        WHERE m.sender_id != $1
          AND ($2::uuid IS NULL OR ${COND})
          AND m.is_deleted = false
          AND m.created_at > GREATEST(
            (SELECT last_read_at FROM room_read_cursors WHERE room_id = m.room_id AND user_id = $1),
            rm.joined_at
          )
        ORDER BY m.created_at ASC
        LIMIT 100`,
};
// 出す前の SQL には -- の注釈があった。比べるときは注釈を除く
const noComments = (s: string) => squash(s.replace(/--[^\n]*/g, ''));

describe('buildBotUnreadQuery (出す前の SQL と同じ)', () => {
  it('部屋を指定: その部屋の、読んだところ (入った時より前は数えない) より後', () => {
    const q = buildBotUnreadQuery({ userId: U, roomId: R, requester: Q, requesterCondition: COND });
    expect(noComments(q.query)).toBe(squash(BEFORE_133.room));
    expect(q.params).toEqual([R, U]);
  });
  it('部屋なし: 入っている全部屋。頼んだ人がいれば、その人も入っている部屋だけ (#564)', () => {
    const q = buildBotUnreadQuery({ userId: U, requester: Q, requesterCondition: COND });
    expect(noComments(q.query)).toBe(squash(BEFORE_133.all));
    expect(q.params).toEqual([U, Q]);
  });
  it('部屋なし・頼んだ人なし: $2 は null (条件は効かない)', () => {
    expect(buildBotUnreadQuery({ userId: U, requester: null, requesterCondition: COND }).params).toEqual([U, null]);
  });
  it('部屋を指定したときは頼んだ人の条件を使わない (メンバーかは道で確かめる)', () => {
    expect(buildBotUnreadQuery({ userId: U, roomId: R, requester: Q, requesterCondition: COND }).query).not.toContain('rq.user_id');
  });
});
