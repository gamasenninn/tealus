/**
 * Tealus MCP ツール テスト
 */

const { TealusClient } = require('../src/tealusClient');
const { registerTools } = require('../src/tools');

// McpServer のモック
function createMockServer() {
  const tools = {};
  return {
    tool: (name, description, schema, handler) => {
      tools[name] = { description, schema, handler };
    },
    getTools: () => tools,
    callTool: async (name, args) => {
      const tool = tools[name];
      if (!tool) throw new Error(`Tool ${name} not found`);
      return tool.handler(args);
    },
  };
}

// TealusClient のモック
function createMockClient() {
  return {
    pushMessage: jest.fn().mockResolvedValue({ message: { id: 'msg1', content: 'hello' } }),
    pushImage: jest.fn().mockResolvedValue({ message: { id: 'msg2', type: 'image' }, media: [] }),
    getMessages: jest.fn().mockResolvedValue({ messages: [{ id: 'msg1', content: 'test' }] }),
    getRooms: jest.fn().mockResolvedValue({ rooms: [{ id: 'room1', name: 'General' }] }),
    joinRoom: jest.fn().mockResolvedValue({ success: true }),
    markRead: jest.fn().mockResolvedValue({ success: true, count: 2 }),
  };
}

describe('Tealus MCP Tools', () => {
  let server, client;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
    registerTools(server, client);
  });

  test('6ツールが登録される', () => {
    const tools = server.getTools();
    expect(Object.keys(tools)).toHaveLength(6);
    expect(tools).toHaveProperty('send_message');
    expect(tools).toHaveProperty('send_image');
    expect(tools).toHaveProperty('get_messages');
    expect(tools).toHaveProperty('list_rooms');
    expect(tools).toHaveProperty('join_room');
    expect(tools).toHaveProperty('mark_read');
  });

  test('send_message がメッセージを送信する', async () => {
    const result = await server.callTool('send_message', { room_id: 'room1', content: 'hello' });
    expect(client.pushMessage).toHaveBeenCalledWith('room1', 'hello');
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toHaveProperty('message');
  });

  test('send_image が画像を送信する', async () => {
    const base64 = Buffer.from('fake-image').toString('base64');
    const result = await server.callTool('send_image', {
      room_id: 'room1',
      image_base64: base64,
      filename: 'test.png',
      caption: 'テスト画像',
    });
    expect(client.pushImage).toHaveBeenCalledWith(
      'room1',
      expect.any(Buffer),
      'test.png',
      'テスト画像'
    );
    expect(result.content[0].type).toBe('text');
  });

  test('get_messages がメッセージ履歴を取得する', async () => {
    const result = await server.callTool('get_messages', { room_id: 'room1', limit: 10 });
    expect(client.getMessages).toHaveBeenCalledWith('room1', 10);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.messages).toHaveLength(1);
  });

  test('get_messages の limit デフォルトは20', async () => {
    await server.callTool('get_messages', { room_id: 'room1' });
    expect(client.getMessages).toHaveBeenCalledWith('room1', 20);
  });

  test('list_rooms がルーム一覧を取得する', async () => {
    const result = await server.callTool('list_rooms', {});
    expect(client.getRooms).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rooms).toHaveLength(1);
  });

  test('join_room がルームに参加する', async () => {
    const result = await server.callTool('join_room', { room_id: 'room1' });
    expect(client.joinRoom).toHaveBeenCalledWith('room1');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  test('mark_read が既読にする', async () => {
    const result = await server.callTool('mark_read', { message_ids: ['msg1', 'msg2'] });
    expect(client.markRead).toHaveBeenCalledWith(['msg1', 'msg2']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
  });
});

describe('TealusClient', () => {
  test('コンストラクタが設定を保持する', () => {
    const client = new TealusClient({
      apiUrl: 'http://localhost:3000',
      userId: 'tanaka',
      password: 'pass',
    });
    expect(client.apiUrl).toBe('http://localhost:3000');
    expect(client.userId).toBe('tanaka');
    expect(client.token).toBeNull();
  });
});
