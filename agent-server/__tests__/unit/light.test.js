/**
 * Light Agent テスト（Agent SDK版）
 */

jest.mock('../../src/lib/botApi', () => ({
  getMessages: jest.fn().mockResolvedValue({ messages: [] }),
  pushMessage: jest.fn().mockResolvedValue({ message: {} }),
  pushStatus: jest.fn().mockResolvedValue({ success: true }),
  getBotUserId: jest.fn(() => 'bot-uuid'),
}));

// @openai/agents をモック
const mockRun = jest.fn();
jest.mock('@openai/agents', () => {
  const { EventEmitter } = require('events');
  return {
    Agent: jest.fn().mockImplementation((opts) => ({ ...opts, _type: 'Agent', eventEmitter: new EventEmitter(), on: jest.fn() })),
    run: mockRun,
    tool: jest.fn((opts) => ({ name: opts.name, _type: 'tool' })),
    codeInterpreterTool: jest.fn(() => ({ name: 'code_interpreter', _type: 'tool' })),
  };
});

jest.mock('zod', () => ({
  z: { object: jest.fn(() => ({})), string: jest.fn(() => ({ describe: jest.fn(() => ({})), optional: jest.fn(() => ({ describe: jest.fn(() => ({})) })) })) },
}));

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  AGENT_LIGHT_MODEL: 'gpt-5.4-mini',
  OPENAI_API_KEY: 'test-key',
  LIGHT_CONTEXT_MESSAGES: 20,
  LIGHT_MAX_TURNS: 10,
}));

jest.mock('../../src/memory/fileMemory', () => ({
  loadMemoryForPrompt: jest.fn(() => ''),
}));

const { processLight, createLightAgent, splitMessage } = require('../../src/agents/light');
const botApi = require('../../src/lib/botApi');

describe('Light Agent (SDK版)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Agent + run で応答を生成して送信する', async () => {
    mockRun.mockResolvedValueOnce({ finalOutput: 'テスト応答です。' });

    await processLight({
      roomId: 'room1',
      prompt: '質問',
      workspacePath: '/tmp/workspace',
    });

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ _type: 'Agent' }),
      '質問',
      expect.objectContaining({ maxTurns: 10 }),
    );
    expect(botApi.pushMessage).toHaveBeenCalledWith('room1', 'テスト応答です。');
  });

  test('エラー時はエラーメッセージを送信', async () => {
    mockRun.mockRejectedValueOnce(new Error('API error'));

    await processLight({
      roomId: 'room1',
      prompt: 'テスト',
      workspacePath: '/tmp/workspace',
    });

    expect(botApi.pushMessage).toHaveBeenCalledWith(
      'room1',
      expect.stringContaining('エラーが発生しました'),
    );
  });

  test('長い応答は分割して送信', async () => {
    mockRun.mockResolvedValueOnce({ finalOutput: 'x'.repeat(5000) });

    await processLight({
      roomId: 'room1',
      prompt: 'テスト',
      workspacePath: '/tmp/workspace',
    });

    expect(botApi.pushMessage).toHaveBeenCalledTimes(2);
  });

  describe('splitMessage', () => {
    test('4000文字以下はそのまま', () => {
      const chunks = splitMessage('hello', 4000);
      expect(chunks).toEqual(['hello']);
    });

    test('4000文字超は分割', () => {
      const chunks = splitMessage('x'.repeat(8500), 4000);
      expect(chunks).toHaveLength(3);
    });
  });

  test('createLightAgent はAgent インスタンスを返す', () => {
    const agent = createLightAgent('/tmp/workspace');
    expect(agent._type).toBe('Agent');
    expect(agent.model).toBe('gpt-5.4-mini');
  });
});
