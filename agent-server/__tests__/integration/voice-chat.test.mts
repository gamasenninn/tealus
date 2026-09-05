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
// ★ ルーム固有の指示のテストで本物のファイルを置くため、ワークスペースを一時 dir にする
process.env.AGENT_WORKSPACE_ROOT = require('node:fs')
  .mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'vc-ws-'));

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

/**
 * #405 R3 昇格 — 会話の中の「良かった 1 つ」を、いま居るルームへ残す (docs/08 §1.2.2)。
 *
 * ★ **これが無い会話モードは作らない**、が設計書の成立条件。捨てるだけなら ChatGPT でよく、
 *   Tealus にしかできないのは「捨てる前提で話した中から良かった 1 つを組織記憶へ上げる」こと。
 *
 * ★ 行き先を選ばせない。会話は**そのルームから開いている**ので、昇格先はそのルーム。
 *   選択画面が要らないぶん、閉じる時にまとめて選ぶ案より安く、押す瞬間も自然になる。
 *
 * ★★ **失敗は必ず見せる。** 道具の実行 (tool-call) は会話を止めないために失敗を飲み込むが、
 *   昇格は**残ったと思って残っていない**のが最悪なので、逆に必ずエラーを返す。
 */
describe('POST /voice-chat/promote — 昇格 (R3)', () => {
  let sessionId: string;

  beforeEach(async () => {
    voiceChat._resetForTest();
    mockListTools.mockReset().mockResolvedValue([
      ...TOOLS,
      { name: 'send_message', description: '送信', inputSchema: { type: 'object', properties: {} } },
    ]);
    mockCallTool.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    stubFetch();
    const res = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token('u1')}`).send({ room_id: 'r1' });
    sessionId = res.body.session_id;
  });

  test('認証なし → 401', async () => {
    const res = await request(app).post('/voice-chat/promote').send({ session_id: sessionId, text: 'あ' });
    expect(res.status).toBe(401);
  });

  test('★ 知らない session → 403 (台帳の検証は tool-call と同じ)', async () => {
    const res = await request(app).post('/voice-chat/promote')
      .set('Authorization', `Bearer ${token('u1')}`).send({ session_id: 'nope', text: 'あ' });
    expect(res.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  test('★ 他人の session では残せない', async () => {
    const res = await request(app).post('/voice-chat/promote')
      .set('Authorization', `Bearer ${token('u2')}`).send({ session_id: sessionId, text: 'あ' });
    expect(res.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  test('本文が空なら 400 (空の便を組織記憶に入れない)', async () => {
    const res = await request(app).post('/voice-chat/promote')
      .set('Authorization', `Bearer ${token('u1')}`).send({ session_id: sessionId, text: '   ' });
    expect(res.status).toBe(400);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  test('★★ 行き先は「会話を開いたルーム」。client に room_id を選ばせない', async () => {
    const res = await request(app).post('/voice-chat/promote')
      .set('Authorization', `Bearer ${token('u1')}`)
      .send({ session_id: sessionId, text: '要点はこうです', room_id: 'ほかの部屋' });
    expect(res.status).toBe(200);
    const [name, args] = mockCallTool.mock.calls[0];
    expect(name).toBe('send_message');
    expect(args.room_id).toBe('r1');            // ★ session の room。body の指定は効かない
  });

  test('★★ どこから来たか分かる印を付ける (普段の AI 応答と区別が付かないと後で混乱する)', async () => {
    await request(app).post('/voice-chat/promote')
      .set('Authorization', `Bearer ${token('u1')}`).send({ session_id: sessionId, text: '要点はこうです' });
    const [, args] = mockCallTool.mock.calls[0];
    expect(args.content).toContain('要点はこうです');
    expect(args.content).toMatch(/会話/);        // 由来が本文から読める
  });

  test('★★★ 送れなかったら必ずエラーを返す (残ったと思って残っていない、を作らない)', async () => {
    mockCallTool.mockRejectedValue(new Error('ルームに投稿できません'));
    const res = await request(app).post('/voice-chat/promote')
      .set('Authorization', `Bearer ${token('u1')}`).send({ session_id: sessionId, text: 'あ' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('残せませんでした');
  });

  test('★ send_message が使えないルームなら、その旨を返す (黙って捨てない)', async () => {
    voiceChat._resetForTest();
    mockListTools.mockResolvedValue(TOOLS);     // send_message 無し
    const s = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token('u1')}`).send({ room_id: 'r1' });
    const res = await request(app).post('/voice-chat/promote')
      .set('Authorization', `Bearer ${token('u1')}`).send({ session_id: s.body.session_id, text: 'あ' });
    expect(res.status).toBe(409);
  });
});

/**
 * ★ ルームごとに、道具を足せるようにする (2026-09-05)。
 *
 * これまで許可リストは**コードに固定の 6 個**で、ルーム固有 MCP (社内DB 等) の道具は
 * **起動して道具一覧まで取ったうえで捨てていた**。守る対象を取り違えていた ——
 * 許可リストは *tealus の破壊的な道具* を守るためのもので、
 * **管理者がそのルームのために意図的に設定した MCP まで巻き添えにしていた**。
 *
 * ★★ 置き場は **DB の列** (`rooms.voice_conversation_tools`)。`room_settings.json` には置かない ——
 *   `PUT /config/room/:roomId/settings` は認証のみでメンバー確認も管理者確認も無く、
 *   **誰でも任意のルームに `execute_sql` を足せてしまう**。
 *   会話モードを開く判定 (`voice_conversation_enabled`) と同じ場所・同じ門にする。
 *
 * ★ 既定は空。**何もしなければ 1 つも増えない。**
 */
describe('POST /voice-chat/session — ルームごとの道具の上乗せ', () => {
  const withTools = (extra: unknown) => {
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/api/rooms/')) {
        return { ok: true, status: 200, json: async () => ({
          room: { id: 'r1', name: '営業報告', voice_conversation_enabled: true, voice_conversation_tools: extra },
        }) };
      }
      return { ok: true, status: 200, json: async () => ({ value: 'ek_1' }) };
    }) as unknown as typeof fetch;
  };
  const names = () => {
    const c = (global.fetch as jest.Mock).mock.calls.find((x) => String(x[0]).includes('client_secrets'));
    return JSON.parse(c[1].body).session.tools.map((t: { name: string }) => t.name);
  };
  const ROOM_TOOLS = [
    ...TOOLS,
    { name: 'execute_sql', description: '社内DB', inputSchema: { type: 'object', properties: {} } },
    { name: 'search_objects', description: 'DB 検索', inputSchema: { type: 'object', properties: {} } },
  ];

  beforeEach(() => {
    voiceChat._resetForTest();
    mockListTools.mockReset().mockResolvedValue(ROOM_TOOLS);
    mockCallTool.mockReset();
  });

  test('★ 既定 (設定なし) では 1 つも増えない', async () => {
    withTools(undefined);
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(names()).not.toContain('execute_sql');
    expect(names()).toContain('get_messages');
  });

  test('★★ 名指しした道具だけ増える', async () => {
    withTools(['search_objects']);
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(names()).toContain('search_objects');
    expect(names()).not.toContain('execute_sql');   // ★ 名指ししていないものは増えない
  });

  test('★★★★ 名指しすれば破壊的な道具も通る (管理者が明示的に許した時だけ)', async () => {
    withTools(['execute_sql']);
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(names()).toContain('execute_sql');
  });

  test('★ 上乗せしても、もとの 6 個は残る', async () => {
    withTools(['execute_sql']);
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    // ★ モックが出す道具のうち、もともと許可されている 2 つ
    for (const n of ['get_messages', 'search_messages']) {
      expect(names()).toContain(n);
    }
    expect(names()).not.toContain('delete_room');   // ★ 上乗せしても、危ないものは通らない
  });

  test('★ 壊れた値 (配列でない / 文字列でない要素) では増やさない', async () => {
    withTools({ nope: true });
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(names()).not.toContain('execute_sql');
  });

  test('★★ 上乗せしたものも、道具の口の検証を通る (session ごとに効く)', async () => {
    withTools(['execute_sql']);
    const s = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    mockCallTool.mockResolvedValue('done');
    const ok = await request(app).post('/voice-chat/tool-call')
      .set('Authorization', `Bearer ${token()}`)
      .send({ session_id: s.body.session_id, call_id: 'c', name: 'execute_sql', arguments: '{}' });
    expect(ok.status).toBe(200);
  });

  test('★★★ 上乗せしていないルームでは、口へ直接投げても実行しない', async () => {
    withTools(undefined);
    const s = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    const ng = await request(app).post('/voice-chat/tool-call')
      .set('Authorization', `Bearer ${token()}`)
      .send({ session_id: s.body.session_id, call_id: 'c', name: 'execute_sql', arguments: '{}' });
    expect(ng.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });
});

/**
 * ★ ルーム固有の指示 (`light_prompt.md`) を会話モードにも渡す (2026-09-05)。
 *
 * ★★ 当初は「毎ターン 96,000 tokens が遅さの正体」(docs/08 §2.4) を根拠に、
 *   system_prompt / light_prompt / 辞書 の 3 つとも外していた。**十把一絡げだった** ——
 *   大きいのは辞書 (57KB) だけで、light_prompt は 8.8KB。しかも **instructions は
 *   セッション内で安定した接頭辞なのでキャッシュが効く** (利用者指摘)。
 *
 * ★ 効果がはっきりしている: 社内DB ルームの light_prompt には「6 つのビューの一覧」と
 *   「用語 → テーブルの対応表」が書いてある。**渡していなかったので、AI は search_objects で
 *   7 回も調べ、権限エラーを踏んでいた。** 答えは最初から用意されていた。
 *
 * ★★★ `default_system_prompt.md` は**入れない。サイズではなく中身の理由**:
 *   「応答前に必ず get_messages で直近を確認」「latency より質を優先」と書いてあり、
 *   **毎ターン道具の往復が挟まる = 基準① (2 秒) と正面から衝突する**。
 *   テキスト経路のために書かれたもので、音声には合わない。
 */
describe('POST /voice-chat/session — ルーム固有の指示', () => {
  const fsx = require('node:fs') as typeof import('node:fs');
  const pathx = require('node:path') as typeof import('node:path');
  // ★ fs をモックせず、**本物のワークスペース**を作る (本番と同じ経路を通す)
  const roomWs = pathx.join(process.env.AGENT_WORKSPACE_ROOT as string, 'agent-1', 'r1');

  const instructions = () => {
    const c = (global.fetch as jest.Mock).mock.calls.find((x) => String(x[0]).includes('client_secrets'));
    return JSON.parse(c[1].body).session.instructions as string;
  };

  beforeEach(() => {
    voiceChat._resetForTest();
    mockListTools.mockReset().mockResolvedValue(TOOLS);
    stubFetch();
    fsx.mkdirSync(roomWs, { recursive: true });
    fsx.rmSync(pathx.join(roomWs, 'light_prompt.md'), { force: true });
  });

  test('★ light_prompt.md があれば instructions に載る', async () => {
    fsx.writeFileSync(pathx.join(roomWs, 'light_prompt.md'), '## このルームの決まり\n入荷は入庫と読み替える');
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(instructions()).toContain('入荷は入庫と読み替える');
  });

  test('★ 無くても落ちない (大半のルームには無い)', async () => {
    const res = await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(res.status).toBe(200);
    expect(instructions()).toContain('話し言葉');   // 共通部分は残る
  });

  test('★★ 共通の指示は消えない (ルーム固有が上書きしない)', async () => {
    fsx.writeFileSync(pathx.join(roomWs, 'light_prompt.md'), 'ルームの決まり');
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    const ins = instructions();
    expect(ins).toContain('ルームの決まり');
    expect(ins).toContain('道具を呼ぶ前に');   // ★ 一言つなぐ = 基準①を守っている指示
  });

  test('★ 空のファイルなら足さない (見出しだけが増えない)', async () => {
    fsx.writeFileSync(pathx.join(roomWs, 'light_prompt.md'), '   \n');
    await request(app).post('/voice-chat/session')
      .set('Authorization', `Bearer ${token()}`).send({ room_id: 'r1' });
    expect(instructions()).not.toContain('このルームの決まり');
  });
});
