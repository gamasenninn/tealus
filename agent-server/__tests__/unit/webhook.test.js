/**
 * Webhook ハンドラのテスト
 */
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
