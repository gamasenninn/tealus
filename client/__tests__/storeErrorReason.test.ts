import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../src/services/api';
import { useRoomStore } from '../src/stores/roomStore';
import { useMessageStore } from '../src/stores/messageStore';

/**
 * #592 (C) 部屋・メッセージを開けないとき、原因を捨てて定型文だけ出していた。
 * ★ サーバは「このルームにアクセスする権限がありません」と返しているのに、画面は「ルーム情報の取得に失敗しました」だけ。
 *   外された部屋のリンクを開いた人・圏外の人・サーバ停止が同じ文になっていた → 理由を添える
 */
describe('#592 開けなかった理由を添える', () => {
  afterEach(() => vi.restoreAllMocks());

  it('★ 部屋: サーバの理由を出す', async () => {
    vi.spyOn(api, 'getRoom').mockRejectedValue(new Error('このルームにアクセスする権限がありません'));
    await useRoomStore.getState().selectRoom('r1');
    expect(useRoomStore.getState().error).toContain('このルームにアクセスする権限がありません');
  });

  it('★ メッセージ: 通信の案内を出す', async () => {
    vi.spyOn(api, 'getMessages').mockRejectedValue(new Error('つながっていません。電波を確かめて、もう一度お試しください'));
    await useMessageStore.getState().fetchMessages('r1');
    expect(useMessageStore.getState().error).toContain('つながっていません');
  });
});
