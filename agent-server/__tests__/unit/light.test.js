/**
 * Light Agent テスト
 */

// botApi をモック
jest.mock('../../src/lib/botApi', () => ({
  getMessages: jest.fn(),
  pushMessage: jest.fn(),
}));

// openai をモック
const mockCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  AGENT_LIGHT_MODEL: 'gpt-5.4-mini',
  OPENAI_API_KEY: 'test-key',
  LIGHT_CONTEXT_MESSAGES: 20,
}));

// memory をモック
jest.mock('../../src/memory/fileMemory', () => ({
  loadMemoryForPrompt: jest.fn(() => ''),
  writeMemory: jest.fn(),
}));

const { processLight } = require('../../src/agents/light');
const botApi = require('../../src/lib/botApi');

describe('Light Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('メッセージを処理して応答を返す', async () => {
    botApi.getMessages.mockResolvedValueOnce({
      messages: [
        { sender_display_name: 'ユーザー', content: '在庫を教えて' },
      ],
    });

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '在庫は100個です。' } }],
    });

    botApi.pushMessage.mockResolvedValueOnce({ message: {} });

    await processLight({
      roomId: 'room1',
      prompt: '在庫を教えて',
      workspacePath: '/tmp/workspace',
    });

    expect(botApi.pushMessage).toHaveBeenCalledWith('room1', '在庫は100個です。');
  });

  test('LLMエラー時はエラーメッセージを送信', async () => {
    botApi.getMessages.mockResolvedValueOnce({ messages: [] });
    mockCreate.mockRejectedValueOnce(new Error('API error'));
    botApi.pushMessage.mockResolvedValueOnce({ message: {} });

    await processLight({
      roomId: 'room1',
      prompt: 'テスト',
      workspacePath: '/tmp/workspace',
    });

    expect(botApi.pushMessage).toHaveBeenCalledWith(
      'room1',
      expect.stringContaining('エラーが発生しました')
    );
  });

  test('会話履歴をコンテキストとして渡す', async () => {
    botApi.getMessages.mockResolvedValueOnce({
      messages: [
        { sender_display_name: '田中', content: '前回の件だけど' },
        { sender_display_name: 'AI', content: '何でしょう？' },
        { sender_display_name: '田中', content: '在庫の件です' },
      ],
    });

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '了解です。' } }],
    });

    botApi.pushMessage.mockResolvedValueOnce({ message: {} });

    await processLight({
      roomId: 'room1',
      prompt: '在庫の件です',
      workspacePath: '/tmp/workspace',
    });

    // LLMに会話履歴が渡されていること
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages.length).toBeGreaterThan(2); // system + 会話履歴 + user
  });
});
