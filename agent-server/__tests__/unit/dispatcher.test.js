/**
 * Dispatcher テスト
 * DM/グループ判定 + メンション検知 + Router→Agent統合
 */

jest.mock('../../src/lib/botApi', () => ({
  getMessages: jest.fn(),
  pushMessage: jest.fn(),
  getRooms: jest.fn(),
  pushStatus: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/router/index', () => ({
  route: jest.fn(),
}));

// ★ dotenv は実環境 .env を load して process.env を上書きするため、test 内で no-op 化
// (= user .env の DEEP_AGENT_PROVIDER=codex 等の dogfood 設定が test 期待値と衝突する事を回避)
jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../../src/agents/light', () => ({
  processLight: jest.fn(),
}));

jest.mock('../../src/agents/lightV2', () => {
  // #292: processLight alias export を mock 反映 (= V2 内部で processLightV2 と同 fn)
  const processLightV2 = jest.fn();
  return {
    processLight: processLightV2,
    processLightV2,
  };
});

// #292: lightBackendLoader を mock、default で V1 mock 返却 (= 既存 test 互換)
jest.mock('../../src/agents/lightBackendLoader', () => ({
  loadLightBackend: jest.fn(),
  resetForTest: jest.fn(),
  KNOWN_BACKENDS: { v1: '../agents/light', v2: '../agents/lightV2' },
}));

jest.mock('../../src/agents/deep', () => ({
  processDeep: jest.fn(),
}));

jest.mock('../../src/agents/deepCodex', () => ({
  processDeepCodex: jest.fn(),
}));

// #276 follow-up: organon polyseme inject を test では no-op 化 (= prompt 内容比較を安定化)
jest.mock('../../src/lib/organonContext', () => ({
  loadOrganonPolysemeForPrompt: () => '',
  isAvailable: () => false,
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

// #295: delegator は handleDelegation を spy 化、parseErrorMessage は実物を使う (通知文の照合用)
jest.mock('../../src/webhook/delegator', () => {
  const actual = jest.requireActual('../../src/webhook/delegator');
  return { ...actual, handleDelegation: jest.fn() };
});

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
      // #292: loadLightBackend を default で V1 mock 返却 (= 既存 test 互換)
      const { loadLightBackend } = require('../../src/agents/lightBackendLoader');
      loadLightBackend.mockReturnValue({ name: 'v1', processLight });
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

  // #295: `%` 委譲検出の dispatcher 結線
  describe('% delegation 結線 (#295)', () => {
    const { handleDelegation } = require('../../src/webhook/delegator');
    const ORIG_FLAG = process.env.ENABLE_CROSS_ROOM_DELEGATION;

    beforeEach(() => {
      jest.clearAllMocks();
      process.env.ENABLE_CROSS_ROOM_DELEGATION = 'true';
      botApi.getRooms.mockResolvedValue({
        rooms: [
          { id: 'r-db', name: '社内DB検索' },
          { id: 'r-sales', name: '営業' },
        ],
      });
      const { loadLightBackend } = require('../../src/agents/lightBackendLoader');
      loadLightBackend.mockReturnValue({ name: 'v2', processLight });
    });

    afterEach(() => {
      if (ORIG_FLAG === undefined) delete process.env.ENABLE_CROSS_ROOM_DELEGATION;
      else process.env.ENABLE_CROSS_ROOM_DELEGATION = ORIG_FLAG;
    });

    test('(a) @mention + %room task → handleDelegation 呼出、route は呼ばない', async () => {
      handleDelegation.mockResolvedValueOnce({ ok: true, text: 'x' });

      await dispatch({
        message: { id: 'm1', content: '@アシスタント %社内DB検索 集計して', sender: { id: 'u1' } },
        room: { id: 'room1', name: 'テスト', member_count: 5 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(handleDelegation).toHaveBeenCalledTimes(1);
      const arg = handleDelegation.mock.calls[0][0];
      expect(arg.originRoomId).toBe('room1');
      expect(arg.targetRoom).toEqual({ id: 'r-db', name: '社内DB検索' });
      expect(arg.task).toBe('集計して');
      expect(route).not.toHaveBeenCalled();
      // 依頼元へ「問い合わせ中」ステータス → idle で clear (#295 dogfood UX fix)
      expect(botApi.pushStatus).toHaveBeenCalledWith('room1', 'processing', expect.stringContaining('社内DB検索'));
      expect(botApi.pushStatus).toHaveBeenCalledWith('room1', 'idle');
    });

    test('(b) %未登録室 → 委譲元へエラー通知、handleDelegation/route 呼ばない', async () => {
      await dispatch({
        message: { id: 'm2', content: '%存在しない室 なにか', sender: { id: 'u1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(handleDelegation).not.toHaveBeenCalled();
      expect(route).not.toHaveBeenCalled();
      expect(botApi.pushMessage).toHaveBeenCalledTimes(1);
      const [rid, text] = botApi.pushMessage.mock.calls[0];
      expect(rid).toBe('room1');
      expect(text).toMatch(/見つかりませんでした/);
    });

    test('(c) フラグ off では %room でも従来どおり route に流れる', async () => {
      process.env.ENABLE_CROSS_ROOM_DELEGATION = 'false';
      route.mockResolvedValueOnce({ tier: 'light', prompt: '%社内DB検索 集計して' });

      await dispatch({
        message: { id: 'm3', content: '%社内DB検索 集計して', sender: { id: 'u1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(handleDelegation).not.toHaveBeenCalled();
      expect(route).toHaveBeenCalled();
    });

    test('(d) 先頭 % でない通常文は route 呼出 (回帰防止)', async () => {
      route.mockResolvedValueOnce({ tier: 'light', prompt: '集計して' });

      await dispatch({
        message: { id: 'm4', content: '集計して', sender: { id: 'u1' } },
        room: { id: 'room1', name: null, member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(handleDelegation).not.toHaveBeenCalled();
      expect(route).toHaveBeenCalled();
    });
  });

  // #270: enqueueForRoom にルーム内処理キューの外側タイムアウトを追加。
  // Light v1/v2 path が SDK 内部でハングして Promise が永久 pending になっても、
  // キュー層が一定時間で強制 resolve し、以降のメッセージがデッドロックしないことを担保する。
  describe('enqueueForRoom outer timeout (#270)', () => {
    const { enqueueForRoom } = require('../../src/webhook/dispatcher');
    const logger = require('../../src/lib/logger');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('T1: 正常完了する fn は実行され、enqueueForRoom が解決する', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      await enqueueForRoom('room-t1', fn, 1000);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('T2: 同一 room の連続タスクは登録順に直列実行される', async () => {
      const order = [];
      const task1 = jest.fn(async () => {
        await new Promise(r => setTimeout(r, 20));
        order.push(1);
      });
      const task2 = jest.fn(async () => {
        order.push(2);
      });
      await enqueueForRoom('room-t2', task1, 1000);
      await enqueueForRoom('room-t2', task2, 1000);
      expect(order).toEqual([1, 2]);
    });

    test('T3: 永久 pending な fn はタイムアウトで unblock され、次のタスクが走る', async () => {
      const hanging = jest.fn(() => new Promise(() => {})); // 永久 pending
      const next = jest.fn().mockResolvedValue('ok');

      // ハングするタスク: timeout=50ms で強制 resolve されるはず
      await enqueueForRoom('room-t3', hanging, 50);
      // 直前のタスクがハングしていても、次は実行できる
      await enqueueForRoom('room-t3', next, 1000);

      expect(hanging).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Room queue task timeout')
      );
    });

    test('T4: fn が throw してもキューは止まらず次が走る (既存挙動の維持)', async () => {
      const failing = jest.fn().mockRejectedValue(new Error('boom'));
      const next = jest.fn().mockResolvedValue('ok');

      await enqueueForRoom('room-t4', failing, 1000);
      await enqueueForRoom('room-t4', next, 1000);

      expect(failing).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // #292 Light backend config 化 (= AGENT_LIGHT_BACKEND 切替動作)
  describe('Light backend config 化 (#292)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      const { loadLightBackend } = require('../../src/agents/lightBackendLoader');
      loadLightBackend.mockReturnValue({ name: 'v1', processLight });
    });

    test("AGENT_LIGHT_BACKEND='v1' で /light → V1 processLight 呼出 (= 既存挙動 retain)", async () => {
      route.mockResolvedValueOnce({ tier: 'light', prompt: 'テスト' });

      await dispatch({
        message: { id: 'msg1', content: 'テスト', sender: { id: 'user1' } },
        room: { id: 'room1', member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(processLight).toHaveBeenCalled();
      const { processLight: v2ProcessLight } = require('../../src/agents/lightV2');
      expect(v2ProcessLight).not.toHaveBeenCalled();
    });

    test("AGENT_LIGHT_BACKEND='v2' で /light → V2 processLight 呼出 (= alias 経由)", async () => {
      const { processLight: v2ProcessLight } = require('../../src/agents/lightV2');
      const { loadLightBackend } = require('../../src/agents/lightBackendLoader');
      loadLightBackend.mockReturnValue({ name: 'v2', processLight: v2ProcessLight });

      route.mockResolvedValueOnce({ tier: 'light', prompt: 'テスト' });

      await dispatch({
        message: { id: 'msg1', content: 'テスト', sender: { id: 'user1' } },
        room: { id: 'room1', member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(v2ProcessLight).toHaveBeenCalled();
      expect(processLight).not.toHaveBeenCalled();
    });

    test('/light2 prefix は config と独立、常に V2 (= 既存挙動 retain、deprecation 段階)', async () => {
      const { processLightV2 } = require('../../src/agents/lightV2');
      const { loadLightBackend } = require('../../src/agents/lightBackendLoader');

      route.mockResolvedValueOnce({ tier: 'light2', prompt: 'テスト' });

      await dispatch({
        message: { id: 'msg1', content: 'テスト', sender: { id: 'user1' } },
        room: { id: 'room1', member_count: 2 },
        agentId: 'agent1',
        agentName: 'アシスタント',
      });

      expect(processLightV2).toHaveBeenCalled();
      // /light2 path は loader 経由しない (= config と独立、router 直接 dispatch)
      expect(loadLightBackend).not.toHaveBeenCalled();
    });
  });
});
