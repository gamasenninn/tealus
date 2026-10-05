/**
 * #501 リプライの引用は、元の投稿の写しを持っている。
 * ★ 削除・編集の知らせが元の投稿 1 つしか書き換えなかったので、開いたままの画面では
 *   引用に消した本文 (直す前の本文) が残っていた。読み込み直すと「(メディア)」と出ていた。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMessageStore } from '../src/stores/messageStore';
import { quoteText } from '../src/utils/replyQuote';

type Q = { id: string; content: string | null; is_deleted?: boolean };
const base = { room_id: 'r1', sender_id: 'u1', type: 'text', created_at: '2026-10-05T00:00:00Z' };
const quotes = () => (useMessageStore.getState().messages as Array<{ id: string; reply_to_message?: Q | null }>)
  .map((m) => m.reply_to_message ?? null);

describe('messageStore — 引用の写し (#501)', () => {
  beforeEach(() => {
    const quote = { id: 'm1', content: '元の本文', type: 'text', sender_id: 'u1', sender_display_name: 'A' };
    useMessageStore.setState({
      messages: [
        { ...base, id: 'm1', content: '元の本文' },
        { ...base, id: 'm2', content: 'リプライ', reply_to: 'm1', reply_to_message: quote },
        { ...base, id: 'm3', content: '別のリプライ', reply_to: 'mX', reply_to_message: { ...quote, id: 'mX', content: '別の元' } },
      ],
    } as never);
  });

  it('★★ 元を消したら、引用も削除済みになり本文が消える', () => {
    useMessageStore.getState().markDeleted('m1');
    const [, q2, q3] = quotes();
    expect(q2).toMatchObject({ id: 'm1', content: null, is_deleted: true });
    expect(q3).toMatchObject({ id: 'mX', content: '別の元' });   // 関係ない引用は触らない
  });

  it('★ 元を編集したら、引用の本文も新しくなる', () => {
    useMessageStore.getState().updateMessageContent('m1', '直した本文', true);
    const [, q2, q3] = quotes();
    expect(q2).toMatchObject({ id: 'm1', content: '直した本文' });
    expect(q3).toMatchObject({ content: '別の元' });
  });

  // ★ #501 の残り: 音声の引用の本文は文字起こし (サーバーは「整形 → 無ければ生」で入れる)
  describe('音声の元の文字起こしを直したとき', () => {
    beforeEach(() => {
      const quote = { id: 'v1', content: '前の整形', type: 'voice', sender_id: 'u1', sender_display_name: 'A' };
      useMessageStore.setState({
        messages: [
          { ...base, id: 'v1', type: 'voice', content: null, transcription: { status: 'done', formatted_text: '前の整形', raw_text: '前の生' } },
          { ...base, id: 'm2', content: 'リプライ', reply_to: 'v1', reply_to_message: quote },
        ],
      } as never);
    });

    it('★★ 整形した文字起こしが変わったら、引用もそれになる', () => {
      useMessageStore.getState().updateTranscription('v1', { status: 'done', formatted_text: '直した整形', raw_text: '前の生' });
      expect(quotes()[1]).toMatchObject({ id: 'v1', content: '直した整形' });
    });

    it('★ 整形が無ければ生の文字起こし (サーバーと同じ規則)', () => {
      useMessageStore.getState().updateTranscription('v1', { status: 'done', formatted_text: null, raw_text: '直した生' } as never);
      expect(quotes()[1]).toMatchObject({ content: '直した生' });
    });

    it('★ 状態だけの知らせ (文字起こし中など) では、引用を触らない', () => {
      useMessageStore.getState().updateTranscription('v1', { status: 'processing' });
      expect(quotes()[1]).toMatchObject({ content: '前の整形' });
    });

    it('削除済みの引用は、文字起こしが来ても本文を戻さない', () => {
      useMessageStore.getState().markDeleted('v1');
      useMessageStore.getState().updateTranscription('v1', { status: 'done', formatted_text: '遅れて来た整形', raw_text: 'x' });
      expect(quotes()[1]).toMatchObject({ content: null, is_deleted: true });
    });
  });
});

describe('quoteText — 引用に出す文字 (#501)', () => {
  it('★ 削除済みは「削除されました」(「(メディア)」と出さない)', () => {
    expect(quoteText({ content: null, is_deleted: true })).toBe('メッセージが削除されました');
  });
  it('★ 削除済みなら、本文が残っていても出さない', () => {
    expect(quoteText({ content: '残っていた本文', is_deleted: true })).toBe('メッセージが削除されました');
  });
  it('本文があれば本文', () => {
    expect(quoteText({ content: 'こんにちは' })).toBe('こんにちは');
  });
  it('本文が無い (画像など) は今までどおり「(メディア)」', () => {
    expect(quoteText({ content: null })).toBe('(メディア)');
  });
});
