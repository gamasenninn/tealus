/**
 * Webhook ハンドラのテスト
 */

// dispatcher をモック
jest.mock('../../src/webhook/dispatcher.mts', () => ({
  dispatch: jest.fn(),
}));

import { handleWebhook, registerBotUserId } from '../../src/webhook/handler.mts';
import { dispatch } from '../../src/webhook/dispatcher.mts';

// logger をモック
jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

import { logger } from '../../src/lib/logger.mts';
import * as botSendThrottle from '../../src/lib/botSendThrottle.mts';
import * as inflightRooms from '../../src/webhook/inflightRooms.mts';
import type { WebhookPayload } from '../../src/types.mts';

describe('Webhook Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // #292 SPIKE: .env が ENABLE_CROSS_ROOM_DELEGATION=true を持ち込む可能性があるため
    // テストごとに明示 unset、各 test が必要なら自前で再設定する
    delete process.env.ENABLE_CROSS_ROOM_DELEGATION;
    botSendThrottle._reset();
    inflightRooms._reset();
  });

  describe('handleWebhook', () => {
    test('message.created イベントを処理する', async () => {
      const payload: WebhookPayload = {
        event: 'message.created',
        message: { id: 'msg1', content: 'こんにちは', sender: { id: 'user1' } },
        room: { id: 'room1', name: 'テスト' },
      };

      await expect(handleWebhook(payload)).resolves.not.toThrow();
    });

    test('未知のイベントは無視する', async () => {
      const payload: WebhookPayload = { event: 'unknown.event' };
      await expect(handleWebhook(payload)).resolves.not.toThrow();
    });
  });

  describe('無限ループ防止', () => {
    test('Botが送信したメッセージは無視する', async () => {
      registerBotUserId('bot1');

      const payload: WebhookPayload = {
        event: 'message.created',
        message: { id: 'msg1', content: 'Bot応答', sender: { id: 'bot1' } },
        room: { id: 'room1', name: 'テスト' },
      };

      await handleWebhook(payload);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Skipped bot message'));
    });

    test('通常ユーザーのメッセージは処理する', async () => {
      const payload: WebhookPayload = {
        event: 'message.created',
        message: { id: 'msg1', content: 'ユーザーメッセージ', sender: { id: 'user1' } },
        room: { id: 'room1', name: 'テスト' },
      };

      await handleWebhook(payload);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Message received'));
    });
  });

  describe('#292 SPIKE: cross-room delegation (in-flight tracking)', () => {
    afterEach(() => {
      delete process.env.ENABLE_CROSS_ROOM_DELEGATION;
      inflightRooms._reset();
      botSendThrottle._reset();
    });

    test('env=true + in-flight room (= 同 room 自送 echo) は block する', async () => {
      process.env.ENABLE_CROSS_ROOM_DELEGATION = 'true';
      registerBotUserId('bot1');
      inflightRooms.add('roomA'); // dispatcher が roomA 処理中と仮定

      const payload: WebhookPayload = {
        event: 'message.created',
        message: { id: 'msg-echo', content: 'bot 自送 echo', sender: { id: 'bot1' } },
        room: { id: 'roomA', name: 'same-room' },
      };

      await handleWebhook(payload);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('[SPIKE] Skipped same-room bot echo'));
    });

    test('env=true + 別 room (= cross-room delegation post) は通す', async () => {
      process.env.ENABLE_CROSS_ROOM_DELEGATION = 'true';
      registerBotUserId('bot1');
      inflightRooms.add('roomA'); // dispatcher は roomA 処理中、別 room roomB へは delegation

      const payload: WebhookPayload = {
        event: 'message.created',
        message: { id: 'msg-delegation', content: '別ルームへの delegation', sender: { id: 'bot1' } },
        room: { id: 'roomB', name: 'cross-room' },
      };

      await handleWebhook(payload);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[SPIKE] cross-room delegation accepted'));
    });

    test('env=true でも spike auto-tripped 時は cross-room delegation を block (= safety fallback)', async () => {
      process.env.ENABLE_CROSS_ROOM_DELEGATION = 'true';
      registerBotUserId('bot1');
      // throttle を SPIKE_TRIP_THRESHOLD 分回して tripped 状態にする
      for (let i = 0; i < botSendThrottle.SPIKE_TRIP_THRESHOLD; i++) botSendThrottle.checkAndRecord();
      expect(botSendThrottle.isSpikeTripped()).toBe(true);

      const payload: WebhookPayload = {
        event: 'message.created',
        message: { id: 'msg', content: 'bot post (post-trip)', sender: { id: 'bot1' } },
        room: { id: 'roomB', name: 'cross-room' }, // 別 room でも tripped 時は block
      };

      await handleWebhook(payload);
      // spike tripped 時は旧挙動 fallback の log message
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Skipped bot message'));
    });

    test('env=false (default) は in-flight 状態を無視して bot 送信を block する (= 旧挙動)', async () => {
      registerBotUserId('bot1');
      inflightRooms.add('roomA'); // SPIKE 無効時は inflight 状態に依存しない

      const payload: WebhookPayload = {
        event: 'message.created',
        message: { id: 'msg', content: 'bot post', sender: { id: 'bot1' } },
        room: { id: 'roomB', name: 'cross-room' },
      };

      await handleWebhook(payload);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Skipped bot message'));
    });
  });

  describe('#338 Phase 2: 編集トリガー (message.updated)', () => {
    // botAgentName='アシスタント' を確定させ、botRoomIds は空(membership check skip)にする
    beforeEach(() => { registerBotUserId('bot1', 'アシスタント'); });

    function updated(over: Partial<{ content: string; previous_content: string; senderId: string; editorId: string }>) {
      return {
        event: 'message.updated',
        message: {
          id: 'm1',
          content: over.content ?? '',
          previous_content: over.previous_content ?? '',
          sender: { id: over.senderId ?? 'user1' },
          edited_by: { id: over.editorId ?? 'user1' },
        },
        room: { id: 'room1', name: 'テスト' },
      } as WebhookPayload;
    }

    test('編集で @アシスタント を新規に付けたら dispatch する', async () => {
      await handleWebhook(updated({ content: '@アシスタント 在庫は？', previous_content: '在庫は？' }));
      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    test('編集前から @アシスタント が付いていたら再発火しない (一度きり)', async () => {
      await handleWebhook(updated({ content: '@アシスタント 在庫は？ 追記', previous_content: '@アシスタント 在庫は？' }));
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('メンションが付かない編集 (誤字修正等) は発火しない', async () => {
      await handleWebhook(updated({ content: '在庫はいくら？', previous_content: '在庫は？' }));
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('他人が編集した場合は発火しない (自分の投稿のみ)', async () => {
      await handleWebhook(updated({ content: '@アシスタント 在庫は？', previous_content: '在庫は？', senderId: 'user1', editorId: 'user2' }));
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('bot 自身の編集は無視する (self-loop 防止)', async () => {
      await handleWebhook(updated({ content: '@アシスタント x', previous_content: 'x', senderId: 'bot1', editorId: 'bot1' }));
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe('ペイロード検証', () => {
    test('messageがないペイロードは警告を出す', async () => {
      const payload: WebhookPayload = { event: 'message.created', room: { id: 'room1' } };
      await handleWebhook(payload);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid payload'));
    });

    test('roomがないペイロードは警告を出す', async () => {
      const payload: WebhookPayload = { event: 'message.created', message: { id: 'msg1' } };
      await handleWebhook(payload);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid payload'));
    });
  });
});
