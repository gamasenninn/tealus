/**
 * Dispatcher テスト
 * DM/グループ判定 + メンション検知 + Router→Agent統合
 */

jest.mock('../../src/lib/botApi', () => ({
  getMessages: jest.fn(),
  pushMessage: jest.fn(),
  getRooms: jest.fn(),
}));

jest.mock('../../src/router/index', () => ({
  route: jest.fn(),
}));

jest.mock('../../src/agents/light', () => ({
  processLight: jest.fn(),
}));

jest.mock('../../src/agents/deep', () => ({
  processDeep: jest.fn(),
}));

jest.mock('../../src/media/messageAdapter', () => ({
  extractPromptFromMessage: jest.fn((msg) => msg?.content || ''),
}));

jest.mock('../../src/mcp/roomMcpManager', () => ({
  getOrCreateRoomMcp: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/context/sessionManager', () => ({
  getOrCreateContext: jest.fn(() => ({ workspace_path: '/tmp/workspace' })),
  updateStatus: jest.fn(),
}));

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

const { isMentioned, dispatch } = require('../../src/webhook/dispatcher');
const { route } = require('../../src/router/index');
const { processLight } = require('../../src/agents/light');
const botApi = require('../../src/lib/botApi');
const sessionManager = require('../../src/context/sessionManager');

describe('Dispatcher', () => {

  describe('isMentioned', () => {
    test('@エージェント名 を検知する', () => {
      expect(isMentioned('こんにちは @アシスタント 在庫教えて', 'アシスタント')).toBe(true);
    });

    test('@なしはメンションではない', () => {
      expect(isMentioned('こんにちは アシスタント', 'アシスタント')).toBe(false);
    });

    test('大文字小文字を区別しない', () => {
      expect(isMentioned('@Assistant help', 'assistant')).toBe(true);
    });

    test('メンション部分を除去したテキストを取得できる', () => {
      const { extractPrompt } = require('../../src/webhook/dispatcher');
      const result = extractPrompt('@アシスタント 在庫を教えて', 'アシスタント');
      expect(result).toBe('在庫を教えて');
    });
  });

  describe('dispatch', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('DM（2名以下）は全メッセージに応答', async () => {
      route.mockResolvedValueOnce({ tier: 'light', prompt: 'テスト' });
      processLight.mockResolvedValueOnce();

      await dispatch({
        message: { id: 'msg1', content: 'テスト', sender: { id: 'user1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(route).toHaveBeenCalled();
      expect(processLight).toHaveBeenCalled();
    });

    test('グループ（3名以上）はメンション時のみ応答', async () => {
      route.mockResolvedValueOnce({ tier: 'light', prompt: '在庫教えて' });
      processLight.mockResolvedValueOnce();

      await dispatch({
        message: { id: 'msg1', content: '@アシスタント 在庫教えて', sender: { id: 'user1' } },
        room: { id: 'room1', name: 'Web部', member_count: 5 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(route).toHaveBeenCalled();
      expect(processLight).toHaveBeenCalled();
    });

    test('グループでメンションなしは応答しない', async () => {
      await dispatch({
        message: { id: 'msg1', content: '普通のメッセージ', sender: { id: 'user1' } },
        room: { id: 'room1', name: 'Web部', member_count: 5 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(route).not.toHaveBeenCalled();
      expect(processLight).not.toHaveBeenCalled();
    });

    test('Router直接応答（挨拶）はBot APIで送信', async () => {
      route.mockResolvedValueOnce({ tier: 'router', response: 'こんにちは！' });
      botApi.pushMessage.mockResolvedValueOnce({ message: {} });

      await dispatch({
        message: { id: 'msg1', content: 'こんにちは', sender: { id: 'user1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(botApi.pushMessage).toHaveBeenCalledWith('room1', 'こんにちは！');
      expect(processLight).not.toHaveBeenCalled();
    });

    test('Deepタスクは一旦メッセージを送って処理（Phase C で本実装）', async () => {
      route.mockResolvedValueOnce({ tier: 'deep', prompt: 'コードをレビューして' });
      botApi.pushMessage.mockResolvedValueOnce({ message: {} });

      await dispatch({
        message: { id: 'msg1', content: '/deep コードをレビューして', sender: { id: 'user1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      const { processDeep } = require('../../src/agents/deep');
      expect(botApi.pushMessage).toHaveBeenCalledWith('room1', expect.stringContaining('高度な分析'));
      expect(processDeep).toHaveBeenCalled();
    });
  });
});
