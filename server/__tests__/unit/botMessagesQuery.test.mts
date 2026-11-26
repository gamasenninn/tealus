/**
 * bot のメッセージ取得 (GET /api/bot/messages) の SQL の組み立て・件数の丸め・文字起こしの列。改善ループ 125 で bot.mts の道から出した (中身は同じ)
 * ★ DB での結果は結合テスト (bot-api など) が見ている。ここは枝ごとの形を固定する
 */
import { buildBotMessagesQuery, latestTranscriptionsQuery, parseBotMessagesLimit, transcriptionColumns } from '../../src/services/botMessagesQuery.mts';

const R = '00000000-0000-0000-0000-00000000000b';
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('parseBotMessagesLimit', () => {
  it('無い・数でない・0 は既定の 20 (#373 呼び出し元は全員 20 を渡している)', () => {
    expect(parseBotMessagesLimit(undefined)).toBe(20);
    expect(parseBotMessagesLimit('abc')).toBe(20);
    expect(parseBotMessagesLimit('0')).toBe(20);
  });

  it('1〜100 に収める', () => {
    expect(parseBotMessagesLimit('-5')).toBe(1);
    expect(parseBotMessagesLimit('1')).toBe(1);
    expect(parseBotMessagesLimit('50')).toBe(50);
    expect(parseBotMessagesLimit('101')).toBe(100);
    expect(parseBotMessagesLimit(30)).toBe(30);
  });
});

describe('buildBotMessagesQuery', () => {
  it('since なし: 新しい順に limit 件 (limit は $2)', () => {
    const { query, params } = buildBotMessagesQuery({ roomId: R, limit: 7 });
    expect(params).toEqual([R, 7]);
    const sql = squash(query);
    expect(sql).toContain('WHERE m.room_id = $1 AND m.is_deleted = false');
    expect(sql).toContain('ORDER BY m.created_at DESC LIMIT $2');
  });

  it('since あり: その後を古い順に。limit は効かせず上限 100 固定 (#373 方針 A: 続きを取りこぼさない)', () => {
    const { query, params } = buildBotMessagesQuery({ roomId: R, since: '2026-11-26T00:00:00Z', limit: 7 });
    expect(params).toEqual([R, '2026-11-26T00:00:00Z']);
    const sql = squash(query);
    expect(sql).toContain('m.created_at > $2');
    expect(sql).toContain('ORDER BY m.created_at ASC LIMIT 100');
  });

  it('送った人の表示名を添える', () => {
    expect(squash(buildBotMessagesQuery({ roomId: R, limit: 20 }).query))
      .toContain('SELECT m.*, u.display_name AS sender_display_name FROM messages m JOIN users u ON u.id = m.sender_id');
  });
});

describe('transcriptionColumns (#219 細かさ)', () => {
  it('既定: 整えた文まで', () => {
    expect(transcriptionColumns(true, false)).toBe('id, status, version, formatted_text');
  });
  it('raw も: 整える前の文まで', () => {
    expect(transcriptionColumns(true, true)).toBe('id, status, version, formatted_text, raw_text');
  });
  it('文字起こしを切ると、raw を頼んでも状態だけ', () => {
    expect(transcriptionColumns(false, true)).toBe('id, status, version');
    expect(transcriptionColumns(false, false)).toBe('id, status, version');
  });
});

describe('latestTranscriptionsQuery (11-26 Q3: まとめて 1 回)', () => {
  it('メッセージごとに最新版 1 行。どの行かは __message_id で返す', () => {
    const sql = squash(latestTranscriptionsQuery('id, status, version'));
    expect(sql).toBe('SELECT DISTINCT ON (message_id) message_id AS __message_id, id, status, version FROM voice_transcriptions WHERE message_id = ANY($1::uuid[]) ORDER BY message_id, version DESC');
  });
});
