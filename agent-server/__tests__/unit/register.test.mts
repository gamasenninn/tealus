/**
 * エージェント登録テスト
 */

jest.mock('../../src/lib/botApi.mts', () => ({
  login: jest.fn().mockResolvedValue({ token: 'test-token', user: { id: 'bot-uuid-123', display_name: 'アシスタント' } }),
  getRooms: jest.fn().mockResolvedValue({ rooms: [{ id: 'room1', name: 'Web部' }] }),
}));

jest.mock('../../src/webhook/handler.mts', () => ({
  registerBotUserId: jest.fn(),
}));

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

jest.mock('../../src/config.mts', () => ({
  TEALUS_BOT_ID: 'AI_AGENT',
  TEALUS_BOT_PASS: 'password',
  TEALUS_API_URL: 'http://localhost:3000',
}));

import { initializeAgent } from '../../src/setup/register.mts';
import * as botApi from '../../src/lib/botApi.mts';
import { registerBotUserId } from '../../src/webhook/handler.mts';
import { logger } from '../../src/lib/logger.mts';

describe('Agent Registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('起動時にBot APIにログインする', async () => {
    await initializeAgent();
    expect(botApi.login).toHaveBeenCalled();
  });

  test('BotユーザーIDをWebhookハンドラーに登録する', async () => {
    await initializeAgent();
    expect(registerBotUserId).toHaveBeenCalled();
  });

  test('参加中のルーム一覧を取得する', async () => {
    const result = await initializeAgent();
    expect(botApi.getRooms).toHaveBeenCalled();
    expect(result.rooms).toHaveLength(1);
  });

  test('ログイン失敗時はエラーをログに記録', async () => {
    (botApi.login as jest.Mock).mockRejectedValueOnce(new Error('Auth failed'));

    await initializeAgent();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Auth failed'));
  });
});
