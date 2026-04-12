/**
 * エージェント登録テスト
 */

jest.mock('../../src/lib/botApi', () => ({
  login: jest.fn().mockResolvedValue('test-token'),
  getRooms: jest.fn().mockResolvedValue({ rooms: [{ id: 'room1', name: 'Web部' }] }),
}));

jest.mock('../../src/webhook/handler', () => ({
  registerBotUserId: jest.fn(),
}));

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  TEALUS_BOT_ID: 'AI_AGENT',
  TEALUS_BOT_PASS: 'password',
  TEALUS_API_URL: 'http://localhost:3000',
}));

const { initializeAgent } = require('../../src/setup/register');
const botApi = require('../../src/lib/botApi');
const { registerBotUserId } = require('../../src/webhook/handler');

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
    botApi.login.mockRejectedValueOnce(new Error('Auth failed'));
    const logger = require('../../src/lib/logger');

    await initializeAgent();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Auth failed'));
  });
});
