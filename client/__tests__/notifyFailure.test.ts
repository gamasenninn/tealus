/**
 * 操作の失敗を黙らない (改善ループ 12 回目、2026-10-23)
 *
 * ★ スタンプ・削除・公開・リアクション・タグ・TODO・中断・全既読の失敗が console にしか出ず、
 *   押しても何も起きない (削除なら確認のあとメッセージが残る) だけだった。理由はサーバが日本語で返している
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { notifyFailure, useConfirmStore } from '../src/stores/confirmStore';

describe('notifyFailure', () => {
  beforeEach(() => { useConfirmStore.setState({ state: null }); });

  test('「〜に失敗しました: 理由」を、OK だけの知らせで出す', () => {
    notifyFailure('削除', new Error('このメッセージは削除できません'));
    const s = useConfirmStore.getState().state as { body: string; hideCancel?: boolean } | null;
    expect(s?.body).toBe('削除に失敗しました: このメッセージは削除できません');
    expect(s?.hideCancel).toBe(true);
  });

  test('理由が取れないときは理由を付けない ([object Object] や undefined を出さない)', () => {
    notifyFailure('スタンプの送信', { weird: 1 });
    const s = useConfirmStore.getState().state as { body: string } | null;
    expect(s?.body).toBe('スタンプの送信に失敗しました');
  });
});
