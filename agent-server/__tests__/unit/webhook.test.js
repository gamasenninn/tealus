/**
 * Webhook ハンドラのテスト
 */

// dispatcher をモック
jest.mock('../../src/webhook/dispatcher', () => ({
  dispatch: jest.fn(),
}));

const { handleWebhook, registerBotUserId } = require('../../src/webhook/handler');

// logger をモック
jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

describe('Webhook Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // #292 SPIKE: .env が ENABLE_CROSS_ROOM_DELEGATION=true を持ち込む可能性があるため
    // テストごとに明示 unset、各 test が必要なら自前で再設定する
    delete process.env.ENABLE_CROSS_ROOM_DELEGATION;
    const throttle = require('../../src/lib/botSendThrottle');
    const inflightRooms = require('../../src/webhook/inflightRooms');
    throttle._reset();
    inflightRooms._reset();
  });

  describe('handleWebhook', () => {
    test('message.created イベントを処理する', async () => {
      const payload = {
        event: 'message.created',
        message: { id: 'msg1', content: 'こんにちは', sender: { id: 'user1' } },
        room: { id: 'room1', name: 'テスト' },
      };

      await expect(handleWebhook(payload)).resolves.not.toThrow();
    });

    test('未知のイベントは無視する', async () => {
      const payload = { event: 'unknown.event' };
      await expect(handleWebhook(payload)).resolves.not.toThrow();
    });
  });

  describe('無限ループ防止', () => {
    test('Botが送信したメッセージは無視する', async () => {
      registerBotUserId('bot1');

      const payload = {
        event: 'message.created',
        message: { id: 'msg1', content: 'Bot応答', sender: { id: 'bot1' } },
        room: { id: 'room1', name: 'テスト' },
      };

      const logger = require('../../src/lib/logger');
      await handleWebhook(payload);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Skipped bot message'));
    });

    test('通常ユーザーのメッセージは処理する', async () => {
      const payload = {
        event: 'message.created',
        message: { id: 'msg1', content: 'ユーザーメッセージ', sender: { id: 'user1' } },
        room: { id: 'room1', name: 'テスト' },
      };

      const logger = require('../../src/lib/logger');
      await handleWebhook(payload);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Message received'));
    });
  });

  describe('#292 SPIKE: cross-room delegation (in-flight tracking)', () => {
    const inflightRooms = require('../../src/webhook/inflightRooms');
    const throttle = require('../../src/lib/botSendThrottle');

    afterEach(() => {
      delete process.env.ENABLE_CROSS_ROOM_DELEGATION;
      inflightRooms._reset();
      throttle._reset();
    });

    test('env=true + in-flight room (= 同 room 自送 echo) は block する', async () => {
      process.env.ENABLE_CROSS_ROOM_DELEGATION = 'true';
      registerBotUserId('bot1');
      inflightRooms.add('roomA'); // dispatcher が roomA 処理中と仮定

      const payload = {
        event: 'message.created',
        message: { id: 'msg-echo', content: 'bot 自送 echo', sender: { id: 'bot1' } },
        room: { id: 'roomA', name: 'same-room' },
      };

      const logger = require('../../src/lib/logger');
      await handleWebhook(payload);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('[SPIKE] Skipped same-room bot echo'));
    });

    test('env=true + 別 room (= cross-room delegation post) は通す', async () => {
      process.env.ENABLE_CROSS_ROOM_DELEGATION = 'true';
      registerBotUserId('bot1');
      inflightRooms.add('roomA'); // dispatcher は roomA 処理中、別 room roomB へは delegation

      const payload = {
        event: 'message.created',
        message: { id: 'msg-delegation', content: '別ルームへの delegation', sender: { id: 'bot1' } },
        room: { id: 'roomB', name: 'cross-room' },
      };

      const logger = require('../../src/lib/logger');
      await handleWebhook(payload);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[SPIKE] cross-room delegation accepted'));
    });

    test('env=true でも spike auto-tripped 時は cross-room delegation を block (= safety fallback)', async () => {
      process.env.ENABLE_CROSS_ROOM_DELEGATION = 'true';
      registerBotUserId('bot1');
      // throttle を SPIKE_TRIP_THRESHOLD 分回して tripped 状態にする
      for (let i = 0; i < throttle.SPIKE_TRIP_THRESHOLD; i++) throttle.checkAndRecord();
      expect(throttle.isSpikeTripped()).toBe(true);

      const payload = {
        event: 'message.created',
        message: { id: 'msg', content: 'bot post (post-trip)', sender: { id: 'bot1' } },
        room: { id: 'roomB', name: 'cross-room' }, // 別 room でも tripped 時は block
      };

      const logger = require('../../src/lib/logger');
      await handleWebhook(payload);
      // spike tripped 時は旧挙動 fallback の log message
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Skipped bot message'));
    });

    test('env=false (default) は in-flight 状態を無視して bot 送信を block する (= 旧挙動)', async () => {
      registerBotUserId('bot1');
      inflightRooms.add('roomA'); // SPIKE 無効時は inflight 状態に依存しない

      const payload = {
        event: 'message.created',
        message: { id: 'msg', content: 'bot post', sender: { id: 'bot1' } },
        room: { id: 'roomB', name: 'cross-room' },
      };

      const logger = require('../../src/lib/logger');
      await handleWebhook(payload);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Skipped bot message'));
    });
  });

  describe('ペイロード検証', () => {
    test('messageがないペイロードは警告を出す', async () => {
      const payload = { event: 'message.created', room: { id: 'room1' } };
      const logger = require('../../src/lib/logger');
      await handleWebhook(payload);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid payload'));
    });

    test('roomがないペイロードは警告を出す', async () => {
      const payload = { event: 'message.created', message: { id: 'msg1' } };
      const logger = require('../../src/lib/logger');
      await handleWebhook(payload);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid payload'));
    });
  });
});
