/**
 * 統合テスト: Webhook → Handler → Dispatcher → Router → Agent
 * 外部依存のみモック。内部モジュール間の結合を検証。
 */

// --- モック設定 ---

jest.mock('../../src/lib/botApi', () => ({
  pushMessage: jest.fn().mockResolvedValue({ message: {} }),
  pushStatus: jest.fn().mockResolvedValue({ success: true }),
  pushImage: jest.fn().mockResolvedValue({ message: {} }),
  getMessages: jest.fn().mockResolvedValue({ messages: [] }),
  getBotUserId: jest.fn(() => 'bot-uuid'),
  getRooms: jest.fn().mockResolvedValue({ rooms: [] }),
}));

jest.mock('../../src/agents/light', () => ({
  processLight: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/agents/deep', () => ({
  processDeep: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/mcp/roomMcpManager', () => ({
  getOrCreateRoomMcp: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/context/sessionManager', () => ({
  getOrCreateContext: jest.fn(() => ({ workspace_path: '/tmp/test-workspace' })),
  updateStatus: jest.fn(),
}));

// Router はルールベースのみ使用（LLM はモック）
const mockLLMClassify = jest.fn().mockResolvedValue({ tier: 'light', prompt: 'test' });
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'light' } }],
        }),
      },
    },
  }));
});

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

jest.mock('../../src/context/settingsManager', () => ({
  loadSettings: jest.fn(),
  getSetting: jest.fn((key, def) => def),
  getAllSettings: jest.fn(() => ({})),
  saveSettings: jest.fn(),
}));

jest.mock('../../src/memory/fileMemory', () => ({
  loadMemoryForPrompt: jest.fn(() => ''),
}));

// fs モック: room_settings.json の存在をコントロール
const actualFs = jest.requireActual('fs');
let mockRoomSettings = null;
jest.mock('fs', () => {
  const original = jest.requireActual('fs');
  return {
    ...original,
    existsSync: jest.fn((p) => {
      if (p.includes('room_settings.json') && mockRoomSettings !== null) return true;
      return original.existsSync(p);
    }),
    readFileSync: jest.fn((p, enc) => {
      if (p.includes('room_settings.json') && mockRoomSettings !== null) {
        return JSON.stringify(mockRoomSettings);
      }
      return original.readFileSync(p, enc);
    }),
  };
});

// --- テスト本体 ---

const { handleWebhook, registerBotUserId } = require('../../src/webhook/handler');
const botApi = require('../../src/lib/botApi');
const { processLight } = require('../../src/agents/light');
const { processDeep } = require('../../src/agents/deep');

const BOT_ID = 'bot-uuid';
const BOT_NAME = 'アシスタント';
const BOT_ROOM = 'room-with-bot';
const OTHER_ROOM = 'room-without-bot';

beforeEach(() => {
  jest.clearAllMocks();
  mockRoomSettings = null;
  // Bot 登録（参加ルーム付き）
  registerBotUserId(BOT_ID, BOT_NAME, [{ id: BOT_ROOM }]);
});

describe('Webhook → Agent 統合テスト', () => {

  // --- 1. DM テキスト → Light 応答 ---
  test('1. DM テキスト → Light 応答', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg1', content: 'テスト質問', type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(processLight).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: BOT_ROOM, prompt: 'テスト質問' })
    );
  });

  // --- 2. グループ @メンション → Light ---
  test('2. グループ @メンション → Light', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg2', content: '@アシスタント 在庫教えて', type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: 'Web部', member_count: 5 },
    });
    expect(processLight).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '在庫教えて' })
    );
  });

  // --- 3. グループ メンションなし → 無視 ---
  test('3. グループ メンションなし → 無視', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg3', content: '普通のメッセージ', type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: 'Web部', member_count: 5 },
    });
    expect(processLight).not.toHaveBeenCalled();
    expect(processDeep).not.toHaveBeenCalled();
    expect(botApi.pushMessage).not.toHaveBeenCalled();
  });

  // --- 4. 挨拶 → Router 直接応答 ---
  test('4. 挨拶 → Router 直接応答', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg4', content: 'こんにちは', type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(botApi.pushMessage).toHaveBeenCalledWith(BOT_ROOM, expect.stringContaining('こんにちは'));
    expect(processLight).not.toHaveBeenCalled();
  });

  // --- 5. /deep コマンド → Deep ---
  test('5. /deep コマンド → Deep', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg5', content: '/deep コードをレビューして', type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(processDeep).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'コードをレビューして' })
    );
  });

  // --- 6. Bot メッセージ → スキップ ---
  test('6. Bot メッセージ → スキップ', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg6', content: '応答です', type: 'text', sender: { id: BOT_ID } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(processLight).not.toHaveBeenCalled();
    expect(processDeep).not.toHaveBeenCalled();
    expect(botApi.pushMessage).not.toHaveBeenCalled();
  });

  // --- 7. 音声 → スキップ ---
  test('7. 音声メッセージ → スキップ（transcription_completed 待ち）', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg7', content: null, type: 'voice', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(processLight).not.toHaveBeenCalled();
  });

  // --- 8. 文字起こし完了 → Light ---
  test('8. 文字起こし完了 → Light', async () => {
    await handleWebhook({
      event: 'voice.transcription_completed',
      message: { id: 'msg8', content: null, type: 'voice', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
      transcription: { formatted_text: '明日の会議について', raw_text: '明日の会議について' },
    });
    expect(processLight).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('明日の会議について') })
    );
  });

  // --- 9. Bot 参加外ルーム → スキップ ---
  test('9. Bot 参加外ルーム → スキップ', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg9', content: 'テスト', type: 'text', sender: { id: 'user1' } },
      room: { id: OTHER_ROOM, name: '他のルーム', member_count: 2 },
    });
    expect(processLight).not.toHaveBeenCalled();
    expect(botApi.pushMessage).not.toHaveBeenCalled();
  });

  // --- 10. response_mode=off → スキップ ---
  test('10. response_mode=off → スキップ', async () => {
    mockRoomSettings = { response_mode: 'off', enabled: true };
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg10', content: 'テスト', type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(processLight).not.toHaveBeenCalled();
    expect(botApi.pushMessage).not.toHaveBeenCalled();
  });

  // --- 11. response_mode=mention → DM メンションなし → スキップ ---
  test('11. response_mode=mention → DM でもメンション必須', async () => {
    mockRoomSettings = { response_mode: 'mention', enabled: true };
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg11', content: 'テスト', type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(processLight).not.toHaveBeenCalled();
  });

  // --- 12. 空メッセージ → スキップ ---
  test('12. 空メッセージ → スキップ', async () => {
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg12', content: null, type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(processLight).not.toHaveBeenCalled();
    expect(botApi.pushMessage).not.toHaveBeenCalled();
  });

  // --- 13. member.joined で Bot 追加 → botRoomIds 更新 ---
  test('13. member.joined で Bot 追加 → 新ルームで応答可能', async () => {
    const NEW_ROOM = 'new-room-id';

    // まず新ルームではスキップされることを確認
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg13a', content: 'テスト', type: 'text', sender: { id: 'user1' } },
      room: { id: NEW_ROOM, name: '新ルーム', member_count: 2 },
    });
    expect(processLight).not.toHaveBeenCalled();

    // Bot が新ルームに参加
    await handleWebhook({
      event: 'member.joined',
      room: { id: NEW_ROOM, name: '新ルーム' },
      member: { user_id: BOT_ID },
    });

    // 参加後は応答される
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg13b', content: 'テスト', type: 'text', sender: { id: 'user1' } },
      room: { id: NEW_ROOM, name: '新ルーム', member_count: 2 },
    });
    expect(processLight).toHaveBeenCalled();
  });

  // --- 14. member.left で Bot 退出 → botRoomIds 削除 ---
  test('14. member.left で Bot 退出 → 旧ルームで応答停止', async () => {
    // まず応答されることを確認
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg14a', content: 'テスト', type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(processLight).toHaveBeenCalled();
    jest.clearAllMocks();

    // Bot が退出
    await handleWebhook({
      event: 'member.left',
      room: { id: BOT_ROOM },
      member: { user_id: BOT_ID },
    });

    // 退出後はスキップ
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg14b', content: 'テスト', type: 'text', sender: { id: 'user1' } },
      room: { id: BOT_ROOM, name: null, member_count: 2 },
    });
    expect(processLight).not.toHaveBeenCalled();
  });

  // --- 15. member.joined で他ユーザー → botRoomIds 変化なし ---
  test('15. member.joined で他ユーザー → botRoomIds 変化なし', async () => {
    await handleWebhook({
      event: 'member.joined',
      room: { id: 'some-room' },
      member: { user_id: 'other-user' },
    });

    // Bot 参加外ルームは依然スキップ
    await handleWebhook({
      event: 'message.created',
      message: { id: 'msg15', content: 'テスト', type: 'text', sender: { id: 'user1' } },
      room: { id: 'some-room', name: null, member_count: 2 },
    });
    expect(processLight).not.toHaveBeenCalled();
  });
});
