/**
 * Light Agent テスト（Agent SDK版）
 */

jest.mock('../../src/lib/botApi.mts', () => ({
  getMessages: jest.fn().mockResolvedValue({ messages: [] }),
  pushMessage: jest.fn().mockResolvedValue({ message: {} }),
  pushStatus: jest.fn().mockResolvedValue({ success: true }),
  getBotUserId: jest.fn(() => 'bot-uuid'),
}));

// @openai/agents をモック
// ESM では import が巻き上げられ、SUT (light.mts) がモジュール読込時に mock を参照するため、
// 外側 const (旧: `const mockRun = jest.fn()`) を factory から参照すると TDZ になる
// (router.test.mts の openai mock と同型の罠)。factory 内で完結させ、`run` は named export
// そのものを後から import して mock 関数として使う。
jest.mock('@openai/agents', () => {
  // require も factory 内で完結させる (外側 import を参照すると同じ理由で TDZ になる)
  const { EventEmitter } = require('node:events');
  return {
    Agent: jest.fn().mockImplementation((opts: object) => ({ ...opts, _type: 'Agent', eventEmitter: new EventEmitter(), on: jest.fn() })),
    run: jest.fn(),
    tool: jest.fn((opts: { name: string }) => ({ name: opts.name, _type: 'tool' })),
    codeInterpreterTool: jest.fn(() => ({ name: 'code_interpreter', _type: 'tool' })),
  };
});

jest.mock('zod', () => ({
  z: { object: jest.fn(() => ({})), string: jest.fn(() => ({ describe: jest.fn(() => ({})), optional: jest.fn(() => ({ describe: jest.fn(() => ({})) })) })) },
}));

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));

jest.mock('../../src/config.mts', () => ({
  AGENT_LIGHT_MODEL: 'gpt-5.4-mini',
  OPENAI_API_KEY: 'test-key',
  LIGHT_CONTEXT_MESSAGES: 20,
  LIGHT_MAX_TURNS: 10,
}));

jest.mock('../../src/memory/fileMemory.mts', () => ({
  loadMemoryForPrompt: jest.fn(() => ''),
}));

import { run } from '@openai/agents';
// mock module の `run` export そのものが jest.fn() インスタンス。テストからの
// mockResolvedValueOnce 等のために jest.Mock として境界 cast する。
const mockRun = run as unknown as jest.Mock;

import { processLight, createLightAgent, splitMessage } from '../../src/agents/light.mts';
import * as botApi from '../../src/lib/botApi.mts';

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
    // mock 実装は runtime に `_type` を持たせるが、実型 (@openai/agents の Agent クラス) には
    // 存在しないプロパティなので境界 cast する。
    const mockedAgent = agent as unknown as { _type: string };
    expect(mockedAgent._type).toBe('Agent');
    expect(agent.model).toBe('gpt-5.4-mini');
  });
});
