/**
 * #405 Realtime 音声会話モードの口 (docs/08 §12)。
 *
 * ここで固定するのは **認可と、道具の絞り込み** の 2 つ。
 *
 * ★ 二段の検証が要る理由 (docs/08 §12.4-4): WebRTC では道具を実行するのが**ブラウザ**なので、
 *   セッション発行時に道具を絞っても、壊れた/悪意あるクライアントは道具の口へ任意の名前を
 *   直接投げられる。こちらは OpenAI と繋がっていないので `call_id` の真正性も確かめられない。
 *   → **台帳を持ち、実行時にも「session が在る / 呼び出し元が一致 / 名前が許可リストに在る」を見る。**
 *
 * ★ 実機でしか確かめられないもの (ここでは固定しない): OpenAI への WebRTC 疎通 /
 *   応答までの実レイテンシ / 押して話すの会話感 / 実 MCP の callTool 所要。docs/08 §12.5。
 */
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.OPENAI_API_KEY = 'sk-test-key';
process.env.TEALUS_API_URL = 'http://tealus.test';

jest.mock('../../src/webhook/routes.mts', () => {
  const express = require('express');
  return { router: express.Router() };
});

// ルーム MCP は起こさない (子プロセスを spawn するため)。listTools / callTool だけ偽装する。
const mockListTools = jest.fn();
const mockCallTool = jest.fn();
jest.mock('../../src/mcp/roomMcpManager.mts', () => ({
  getOrCreateRoomMcp: jest.fn(async () => [{
    listTools: mockListTools,
    callTool: mockCallTool,
  }]),
}));

// agentId の出どころ。bot がログインしていないと null なので固定する。
jest.mock('../../src/webhook/handler.mts', () => {
  const actual = jest.requireActual('../../src/webhook/handler.mts');
  return { ...actual, getBotIdentity: () => ({ user_id: 'agent-1', display_name: 'アシスタント' }) };
});

const { app } = require('../../src/app.mts') as { app: import('express').Express };
const voiceChat = require('../../src/routes/voiceChat.mts') as { _resetForTest: () => void };

function token(userId = 'u1'): string {
  return jwt.sign({ id: userId, login_id: 'EMP001' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
}

/** 本体 GET /api/rooms/:id と OpenAI client_secrets の 2 つを偽装する */
function stubFetch(opts: { roomStatus?: number; enabled?: boolean; secretStatus?: number } = {}) {
  const { roomStatus = 200, enabled = true, secretStatus = 200 } = opts;
  global.fetch = jest.fn(async (url: string) => {
    if (String(url).includes('/api/rooms/')) {
      if (roomStatus !== 200) return { ok: false, status: roomStatus, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ room: { id: 'r1', name: '営業報告', voice_conversation_enabled: enabled } }),
      };
    }
    if (String(url).includes('client_secrets')) {
      if (secretStatus !== 200) return { ok: false, status: secretStatus, text: async () => 'boom' };
      return { ok: true, status: 200, json: async () => ({ value: 'ek_test_123', expires_at: 9999 }) };
    }
    throw new Error(`想定外の fetch: ${url}`);
  }) as unknown as typeof fetch;
}

const TOOLS = [
  { name: 'get_messages', description: 'ルームの履歴', inputSchema: { type: 'object', properties: { room_id: { type: 'string' } }, required: ['room_id'] } },
  { name: 'search_messages', description: '検索', inputSchema: { type: 'object', properties: {} } },
  { name: 'delete_room', description: '★ 許可リストに無い破壊的な道具', inputSchema: { type: 'object', properties: {} } },
];

describe('POST /voice-chat/session', () => {
  beforeEach(() => {
    voiceChat._resetForTest();
    mockListTools.mockReset().mockResolvedValue(TOOLS);
    mockCallTool.mockReset();
    stubFetch();
  });

  test('認証なし → 401', async () => {
    const res = await request(app).post('/voice-chat/session').send({ room_id: 'r1' });
    expect(res.status).toBe(401);
  });

  test('room_id が無ければ 400', async () => {
    const res = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({});
    expect(res.status).toBe(400);
  });

  test('★ 開けていないルーム (flag=false) → 403。既定で開かないことの担保', async () => {
    stubFetch({ enabled: false });
    const res = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(res.status).toBe(403);
  });

  test('★ 非メンバー (本体が 403 を返す) → 403', async () => {
    stubFetch({ roomStatus: 403 });
    const res = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(res.status).toBe(403);
  });

  test('★ 開けたルーム → 使い捨てトークンを返す', async () => {
    const res = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(res.status).toBe(200);
    expect(res.body.client_secret).toBe('ek_test_123');
    expect(typeof res.body.session_id).toBe('string');
  });

  test('★★ 道具は許可リストで絞られ、JSON Schema がそのまま parameters になる', async () => {
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });

    const secretCall = (global.fetch as jest.Mock).mock.calls
      .find((c) => String(c[0]).includes('client_secrets'));
    // ★ 公式の形は { session: {...} }。フラットではない (2026-09-05 ドキュメントで確認)
    const { session } = JSON.parse(secretCall[1].body);
    const names = session.tools.map((t: { name: string }) => t.name);

    expect(names).toContain('get_messages');
    expect(names).not.toContain('delete_room');   // ★ 許可リストに無いものは出さない
    expect(session.tools[0].type).toBe('function');
    expect(session.tools[0].parameters).toEqual(TOOLS[0].inputSchema);
  });

  test('★ 押して話す: サーバ側の発話検知は切る (turn_detection: null)', async () => {
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    const secretCall = (global.fetch as jest.Mock).mock.calls
      .find((c) => String(c[0]).includes('client_secrets'));
    expect(JSON.parse(secretCall[1].body).session.audio.input.turn_detection).toBeNull();
  });

  test('★ API キーはブラウザに返さない', async () => {
    const res = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(JSON.stringify(res.body)).not.toContain('sk-test-key');
  });
});

describe('POST /voice-chat/tool-call — 台帳の検証 (二段目)', () => {
  let sessionId: string;

  beforeEach(async () => {
    voiceChat._resetForTest();
    mockListTools.mockReset().mockResolvedValue(TOOLS);
    mockCallTool.mockReset().mockResolvedValue({ content: [{ type: 'text', text: '3 件見つかりました' }] });
    stubFetch();
    const res = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token('u1')}`).send({ room_id: 'r1' });
    sessionId = res.body.session_id;
  });

  test('★ 知らない session → 403', async () => {
    const res = await request(app).post('/voice-chat/tool-call')
      .set('Authorization', `Bearer ${token('u1')}`)
      .send({ session_id: 'nope', call_id: 'c1', name: 'get_messages', arguments: '{}' });
    expect(res.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  test('★★ 他人の session は使えない (発行した本人以外は 403)', async () => {
    const res = await request(app).post('/voice-chat/tool-call')
      .set('Authorization', `Bearer ${token('u2')}`)
      .send({ session_id: sessionId, call_id: 'c1', name: 'get_messages', arguments: '{}' });
    expect(res.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  test('★★★★ 許可リストに無い道具は、直接投げても実行しない', async () => {
    const res = await request(app).post('/voice-chat/tool-call')
      .set('Authorization', `Bearer ${token('u1')}`)
      .send({ session_id: sessionId, call_id: 'c1', name: 'delete_room', arguments: '{}' });
    expect(res.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  test('★ 通れば実行して、結果を文字列で返す', async () => {
    const res = await request(app).post('/voice-chat/tool-call')
      .set('Authorization', `Bearer ${token('u1')}`)
      .send({ session_id: sessionId, call_id: 'c1', name: 'get_messages', arguments: '{"room_id":"r1"}' });
    expect(res.status).toBe(200);
    expect(mockCallTool).toHaveBeenCalledWith('get_messages', { room_id: 'r1' });
    expect(res.body.output).toContain('3 件見つかりました');
    expect(typeof res.body.elapsed_ms).toBe('number');
  });

  test('★ 道具が投げても 500 にせず、モデルに返せる形で返す (会話を止めない)', async () => {
    mockCallTool.mockRejectedValue(new Error('MCP が落ちています'));
    const res = await request(app).post('/voice-chat/tool-call')
      .set('Authorization', `Bearer ${token('u1')}`)
      .send({ session_id: sessionId, call_id: 'c1', name: 'get_messages', arguments: '{}' });
    expect(res.status).toBe(200);
    expect(res.body.output).toContain('MCP が落ちています');
  });
});
