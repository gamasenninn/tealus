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

jest.mock('../../src/agents/lightV2', () => ({
  processLightV2: jest.fn(),
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

    test('agentId が null の場合は安全に skip (#225 init failure guard)', async () => {
      const logger = require('../../src/lib/logger');

      await dispatch({
        message: { id: 'msg1', content: 'こんにちは', sender: { id: 'user1' } },
        room: { id: 'room1', name: '総務グループ', member_count: 5 },
        agentId: null,
        agentName: null,
      });

      // route / processLight / sessionManager どれも呼ばれない
      expect(route).not.toHaveBeenCalled();
      expect(processLight).not.toHaveBeenCalled();
      expect(sessionManager.getOrCreateContext).not.toHaveBeenCalled();

      // 採用者向けの診断 message が出力される
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('agent-server is not initialized')
      );
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

    test('DeepタスクはprocessDeepを呼ぶ', async () => {
      route.mockResolvedValueOnce({ tier: 'deep', prompt: 'コードをレビューして' });

      await dispatch({
        message: { id: 'msg1', content: '/deep コードをレビューして', sender: { id: 'user1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      const { processDeep } = require('../../src/agents/deep');
      expect(processDeep).toHaveBeenCalled();
    });

    test('tier=unavailable は説明メッセージを送信、Light/Deep は呼ばない', async () => {
      route.mockResolvedValueOnce({ tier: 'unavailable', prompt: 'コード書いて' });
      botApi.pushMessage.mockResolvedValueOnce({ message: {} });

      await dispatch({
        message: { id: 'msg1', content: '/deep コード書いて', sender: { id: 'user1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(botApi.pushMessage).toHaveBeenCalledTimes(1);
      const sentMessage = botApi.pushMessage.mock.calls[0][1];
      expect(sentMessage).toMatch(/Deep agent.*Claude Code CLI|Claude MAX/);
      expect(processLight).not.toHaveBeenCalled();
      const { processDeep } = require('../../src/agents/deep');
      expect(processDeep).not.toHaveBeenCalled();
    });
  });

  // 朝礼ルーム TODO 抽出 bug 起点で導入: dispatcher が message.reply_to を agent prompt に
  // embed して、agent が reply 先 message を最優先 context として扱えるようにする。
  // 5/14 朝礼 room で reply_to 指定しても agent が前回議事録の TODO を verbatim copy する
  // 問題 (3 層 cause の L1+L2 部分) の構造修正。
  describe('reply_to embed in agent prompt', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('B1: reply_to なしの場合、light prompt に hint を追加しない (既存挙動 retain)', async () => {
      route.mockResolvedValueOnce({ tier: 'light', prompt: 'テスト' });
      processLight.mockResolvedValueOnce();

      await dispatch({
        message: { id: 'msg1', content: 'テスト', sender: { id: 'user1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(processLight).toHaveBeenCalledTimes(1);
      const prompt = processLight.mock.calls[0][0].prompt;
      expect(prompt).not.toMatch(/message id=/);
      expect(prompt).not.toMatch(/\*\*重要\*\*/);
    });

    test('B2: reply_to ありの場合、light prompt に hint が embed される', async () => {
      route.mockResolvedValueOnce({ tier: 'light', prompt: 'この議事録の TODO' });
      processLight.mockResolvedValueOnce();

      await dispatch({
        message: {
          id: 'msg2',
          content: 'この議事録の TODO',
          reply_to: 'msg-target-123',
          sender: { id: 'user1' },
        },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(processLight).toHaveBeenCalledTimes(1);
      const prompt = processLight.mock.calls[0][0].prompt;
      expect(prompt).toMatch(/message id="msg-target-123"/);
      expect(prompt).toMatch(/最優先/);
      // user prompt と room ID は維持されている
      expect(prompt).toContain('ユーザーの質問:');
      expect(prompt).toContain('room1');
    });

    test('B3: reply_to ありで light2 path に dispatch される時、light2 prompt にも hint embed', async () => {
      route.mockResolvedValueOnce({ tier: 'light2', prompt: 'この議事録の TODO' });
      const { processLightV2 } = require('../../src/agents/lightV2');
      processLightV2.mockResolvedValueOnce();

      await dispatch({
        message: {
          id: 'msg3',
          content: '/light2 この議事録の TODO',
          reply_to: 'msg-target-456',
          sender: { id: 'user1' },
        },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(processLightV2).toHaveBeenCalledTimes(1);
      const prompt = processLightV2.mock.calls[0][0].prompt;
      expect(prompt).toMatch(/message id="msg-target-456"/);
      expect(prompt).toMatch(/最優先/);
    });

    test('B4: reply_to ありで deep path に dispatch される時、deep prompt にも hint embed', async () => {
      route.mockResolvedValueOnce({ tier: 'deep', prompt: 'この議事録の TODO' });
      const { processDeep } = require('../../src/agents/deep');
      processDeep.mockResolvedValueOnce();

      await dispatch({
        message: {
          id: 'msg4',
          content: '/deep この議事録の TODO',
          reply_to: 'msg-target-789',
          sender: { id: 'user1' },
        },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(processDeep).toHaveBeenCalledTimes(1);
      const prompt = processDeep.mock.calls[0][0].prompt;
      expect(prompt).toMatch(/message id="msg-target-789"/);
      expect(prompt).toMatch(/最優先/);
    });

    test('B5: reply_to = "" または null の場合、hint は追加しない (truthy check)', async () => {
      // ケース 1: reply_to = ""
      route.mockResolvedValueOnce({ tier: 'light', prompt: 'テスト' });
      processLight.mockResolvedValueOnce();

      await dispatch({
        message: { id: 'msg5a', content: 'テスト', reply_to: '', sender: { id: 'user1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(processLight.mock.calls[0][0].prompt).not.toMatch(/message id=/);

      // ケース 2: reply_to = null (明示)
      jest.clearAllMocks();
      route.mockResolvedValueOnce({ tier: 'light', prompt: 'テスト' });
      processLight.mockResolvedValueOnce();

      await dispatch({
        message: { id: 'msg5b', content: 'テスト', reply_to: null, sender: { id: 'user1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(processLight.mock.calls[0][0].prompt).not.toMatch(/message id=/);
    });

    test('B6: reply_to_message.content がある場合、本文を verbatim で hint に embed (LLM が tool call 不要で参照可能)', async () => {
      route.mockResolvedValueOnce({ tier: 'light', prompt: 'この議事録の TODO' });
      processLight.mockResolvedValueOnce();

      const replyContent = `# 議事録\n## 1. 売上\n- 目標 7,500万\n## 2. ファーム\n- トマトの芽かき`;
      await dispatch({
        message: {
          id: 'msg6',
          content: 'この議事録の TODO',
          reply_to: 'msg-target-999',
          reply_to_message: {
            id: 'msg-target-999',
            content: replyContent,
            sender_display_name: 'アシスタント',
            type: 'text',
          },
          sender: { id: 'user1' },
        },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(processLight).toHaveBeenCalledTimes(1);
      const prompt = processLight.mock.calls[0][0].prompt;
      // 本文 verbatim embed (改行込みで literal に含まれる)
      expect(prompt).toContain('# 議事録');
      expect(prompt).toContain('トマトの芽かき');
      expect(prompt).toContain('目標 7,500万');
      // ID も明示されている
      expect(prompt).toContain('id="msg-target-999"');
      // chat history copy 禁止 instruction
      expect(prompt).toMatch(/chat history|過去応答|literal/);
    });

    test('B7: reply_to あり + reply_to_message.content が null/未定義の場合、ID-only fallback', async () => {
      route.mockResolvedValueOnce({ tier: 'light', prompt: 'テスト' });
      processLight.mockResolvedValueOnce();

      await dispatch({
        message: {
          id: 'msg7',
          content: 'テスト',
          reply_to: 'msg-target-no-content',
          reply_to_message: { id: 'msg-target-no-content', content: null },
          sender: { id: 'user1' },
        },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      const prompt = processLight.mock.calls[0][0].prompt;
      // fallback: ID は明示、get_messages 指示
      expect(prompt).toContain('message id="msg-target-no-content"');
      expect(prompt).toMatch(/get_messages/);
      // 「対象 message ここまで」は出ない (content embed mode ではない)
      expect(prompt).not.toMatch(/対象 message ここまで/);
    });
  });
});
