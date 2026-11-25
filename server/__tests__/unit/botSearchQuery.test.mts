/**
 * bot の検索 (GET /api/bot/search) の SQL の組み立て。改善ループ 121 で bot.mts の道から出した (中身は同じ)
 * ★ DB での結果は結合テスト (bot-api・botSearchTimezone・botRequesterScope) が見ている。
 *   ここは「params の並び」と「$n の番号」が食い違わないことを枝ごとに固定する (ずれると別の値で絞られる)
 */
import { buildBotSearchQuery, type BotSearchFilters } from '../../src/services/botSearchQuery.mts';
import { resolveTimeZone } from '../../src/lib/localTime.mts';

const U = '00000000-0000-0000-0000-00000000000a';
const R = '00000000-0000-0000-0000-00000000000b';
const Q = '00000000-0000-0000-0000-00000000000c';
const base: BotSearchFilters = { userId: U, requester: null, tagNames: [], escapedQ: null, limit: 10, offset: 0 };
const squash = (s: string) => s.replace(/\s+/g, ' ');

describe('buildBotSearchQuery', () => {
  it('語なし・部屋だけ: 1 本の SELECT。limit は 1 つ多く取る (続きの有無を見るため)', () => {
    const { query, params } = buildBotSearchQuery({ ...base, roomId: R, offset: 20 });
    expect(params).toEqual([U, R, 11, 20]);
    const sql = squash(query);
    expect(sql).toContain('rm.user_id = $1');
    expect(sql).toContain('m.room_id = $2');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(sql).not.toContain('UNION');
  });

  it('依頼した人がいれば、その人の入っている部屋に絞る条件が部屋の次に入る', () => {
    const { query, params } = buildBotSearchQuery({ ...base, roomId: R, requester: Q, senderId: U });
    expect(params).toEqual([U, R, Q, U, 11, 0]);
    const sql = squash(query);
    expect(sql).toContain('rq.user_id = $3');
    expect(sql).toContain('m.sender_id = $4');
  });

  it('語あり: 本文と文字起こしの 2 本を UNION。語は %…% で limit の前', () => {
    const { query, params } = buildBotSearchQuery({ ...base, escapedQ: 'トラクター', limit: 5 });
    expect(params).toEqual([U, '%トラクター%', 6, 0]);
    const sql = squash(query);
    expect(sql).toContain('UNION');
    expect(sql).toContain("m.content ILIKE $2 ESCAPE '\\'");
    expect(sql).toContain("vt.formatted_text ILIKE $2 ESCAPE '\\' OR vt.raw_text ILIKE $2");
    expect(sql).toContain('LIMIT $3 OFFSET $4');
  });

  it('語あり + type=voice: 文字起こしの道だけ (UNION なし)', () => {
    const { query, params } = buildBotSearchQuery({ ...base, escapedQ: 'x', type: 'voice' });
    expect(params).toEqual([U, 'voice', '%x%', 11, 0]);
    const sql = squash(query);
    expect(sql).not.toContain('UNION');
    expect(sql).not.toContain('m.content ILIKE');
    expect(sql).toContain('vt.formatted_text ILIKE $3');
  });

  it('語あり + type=text: 本文の道だけ', () => {
    const { query } = buildBotSearchQuery({ ...base, escapedQ: 'x', type: 'text' });
    const sql = squash(query);
    expect(sql).not.toContain('UNION');
    expect(sql).toContain('m.content ILIKE $3');
    expect(sql).not.toContain('vt.formatted_text ILIKE');
  });

  it('タグ: 名前・名前の数・済みかの順に積み、全部のタグが付いたものだけ (HAVING)', () => {
    const { query, params } = buildBotSearchQuery({ ...base, tagNames: ['TODO', '見積'], isDone: 'false' });
    expect(params).toEqual([U, 'TODO', '見積', 2, false, 11, 0]);
    const sql = squash(query);
    expect(sql).toContain('WITH tag_match AS');
    expect(sql).toContain('t.name IN ($2, $3) AND mt.is_done = $5');
    expect(sql).toContain('HAVING COUNT(DISTINCT t.name) = $4');
    expect(sql).toContain('m.id IN (SELECT message_id FROM tag_match)');
  });

  it('タグの済みかが空なら絞らない', () => {
    const { query, params } = buildBotSearchQuery({ ...base, tagNames: ['TODO'], isDone: '' });
    expect(params).toEqual([U, 'TODO', 1, 11, 0]);
    expect(squash(query)).not.toContain('mt.is_done');
  });

  it('時間帯の無い日付はサーバーの時間帯で読む (値の次に時間帯を積む)。書いてあればそのまま', () => {
    const { query, params } = buildBotSearchQuery({ ...base, since: '2026-10-01', until: '2026-10-31T23:59:59+09:00' });
    expect(params).toEqual([U, '2026-10-01', resolveTimeZone(), '2026-10-31T23:59:59+09:00', 11, 0]);
    const sql = squash(query);
    expect(sql).toContain('m.created_at >= ($2::timestamp AT TIME ZONE $3)');
    expect(sql).toContain('m.created_at <= $4::timestamptz');
  });

  it('リアクションの有無は値を積まない述語。空なら絞らない', () => {
    expect(squash(buildBotSearchQuery({ ...base, roomId: R, hasReaction: 'false' }).query))
      .toContain('NOT EXISTS (SELECT 1 FROM message_reactions mr WHERE mr.message_id = m.id)');
    expect(squash(buildBotSearchQuery({ ...base, roomId: R, hasReaction: true }).query))
      .toMatch(/AND EXISTS \(SELECT 1 FROM message_reactions/);
    expect(squash(buildBotSearchQuery({ ...base, roomId: R, hasReaction: '' }).query))
      .not.toContain('message_reactions');
  });
});
