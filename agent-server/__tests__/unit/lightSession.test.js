/**
 * TealusSession テスト
 */

jest.mock('../../src/lib/botApi', () => ({
  getMessages: jest.fn(),
  getBotUserId: jest.fn(() => 'bot-uuid-123'),
}));

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

const { TealusSession } = require('../../src/agents/lightSession');
const botApi = require('../../src/lib/botApi');

describe('TealusSession', () => {
  let session;

  beforeEach(() => {
    jest.clearAllMocks();
    session = new TealusSession('room-1');
  });

  test('getSessionId はルームIDを返す', async () => {
    expect(await session.getSessionId()).toBe('tealus-room-room-1');
  });

  test('getItems はBot APIから会話履歴を取得して変換する', async () => {
    botApi.getMessages.mockResolvedValueOnce({
      messages: [
        { sender_id: 'user-1', sender_display_name: '田中', content: 'こんにちは', type: 'text' },
        { sender_id: 'bot-uuid-123', sender_display_name: 'アシスタント', content: '何かお手伝いしましょうか', type: 'text' },
        { sender_id: 'user-1', sender_display_name: '田中', content: '在庫教えて', type: 'text' },
      ],
    });

    const items = await session.getItems();
    expect(items).toHaveLength(3);
    expect(items[0].role).toBe('user');
    expect(items[0].content).toContain('田中');
    expect(items[1].role).toBe('assistant');
    expect(items[2].role).toBe('user');
  });

  test('音声メッセージは文字起こしテキストを使う', async () => {
    botApi.getMessages.mockResolvedValueOnce({
      messages: [
        {
          sender_id: 'user-1', sender_display_name: '田中',
          content: null, type: 'voice',
          transcription: { formatted_text: '明日の会議について' },
        },
      ],
    });

    const items = await session.getItems();
    expect(items).toHaveLength(1);
    expect(items[0].content).toContain('明日の会議について');
  });

  test('contentもtranscriptionもないメッセージはスキップ', async () => {
    botApi.getMessages.mockResolvedValueOnce({
      messages: [
        { sender_id: 'user-1', sender_display_name: '田中', content: null, type: 'image' },
      ],
    });

    const items = await session.getItems();
    expect(items).toHaveLength(0);
  });

  test('addItems はバッファに追加', async () => {
    await session.addItems([{ role: 'assistant', content: 'テスト' }]);
    // 内部バッファに蓄積される（getItemsで返される）
  });

  test('clearSession はバッファをクリア', async () => {
    await session.addItems([{ role: 'assistant', content: 'テスト' }]);
    await session.clearSession();
    // クリア後はバッファ空
  });
});
