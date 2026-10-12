/**
 * エージェント登録テスト
 */

jest.mock('../../src/lib/botApi.mts', () => ({
  login: jest.fn().mockResolvedValue({ token: 'test-token', user: { id: 'bot-uuid-123', display_name: 'アシスタント' } }),
  getRooms: jest.fn().mockResolvedValue({ rooms: [{ id: 'room1', name: 'Web部' }] }),
}));

jest.mock('../../src/webhook/handler.mts', () => ({
  registerBotUserId: jest.fn(),
}));

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

// ★ 本物の MCP (npx で子プロセス) を起こさない (2026-10-02 に起動時の warmSharedGlobal を足した)
const mockWarm = jest.fn(() => new Promise<void>(() => {})); // ★ 終わらない = 起動がこれを待たないことを見る
jest.mock('../../src/mcp/roomMcpManager.mts', () => ({
  startSweeper: jest.fn(),
  warmSharedGlobal: () => mockWarm(),
}));

jest.mock('../../src/config.mts', () => ({
  TEALUS_BOT_ID: 'AI_AGENT',
  TEALUS_BOT_PASS: 'password',
  TEALUS_API_URL: 'http://localhost:3000',
}));

import { initializeAgent, initializeAgentWithRetry } from '../../src/setup/register.mts';
import * as botApi from '../../src/lib/botApi.mts';
import { registerBotUserId } from '../../src/webhook/handler.mts';
import { logger } from '../../src/lib/logger.mts';
import { isInitInProgress } from '../../src/lib/initGate.mts';

describe('Agent Registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('起動時にBot APIにログインする', async () => {
    await initializeAgent();
    expect(botApi.login).toHaveBeenCalled();
  });

  test('BotユーザーIDをWebhookハンドラーに登録する', async () => {
    await initializeAgent();
    expect(registerBotUserId).toHaveBeenCalled();
  });

  test('参加中のルーム一覧を取得する', async () => {
    const result = await initializeAgent();
    expect(botApi.getRooms).toHaveBeenCalled();
    expect(result.rooms).toHaveLength(1);
  });

  test('★ 共有 MCP を裏で先に起こし始める。起動はそれを待たない (2026-10-02、会話モードの 1 回目の待ち)', async () => {
    const result = await initializeAgent(); // ★ mockWarm は終わらないので、待っていればここで止まる
    expect(mockWarm).toHaveBeenCalledTimes(1);
    expect(result.rooms).toHaveLength(1);
  });

  test('ログイン失敗時はエラーをログに記録', async () => {
    (botApi.login as jest.Mock).mockRejectedValueOnce(new Error('Auth failed'));

    await initializeAgent();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Auth failed'));
  });

  test('#581 結果に成否 (ok) を持たせる', async () => {
    expect((await initializeAgent()).ok).toBe(true);
    (botApi.login as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await initializeAgent()).ok).toBe(false);
  });
});

describe('#581 起動時につながらなければ、つながるまで試し直す', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('★ 2 回失敗して 3 回目でつながる → Bot の ID は 1 回だけ登録される', async () => {
    (botApi.login as jest.Mock)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const sleep = jest.fn((_ms: number) => Promise.resolve());
    const result = await initializeAgentWithRetry({ delaysMs: [5000, 15000, 30000, 60000], sleep });
    expect(result.ok).toBe(true);
    expect(botApi.login).toHaveBeenCalledTimes(3);
    expect(registerBotUserId).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls).toEqual([[5000], [15000]]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('3 回目'));
  });

  test('間隔は最後の値で頭打ちになる', async () => {
    for (let i = 0; i < 5; i++) (botApi.login as jest.Mock).mockRejectedValueOnce(new Error('x'));
    const sleep = jest.fn((_ms: number) => Promise.resolve());
    await initializeAgentWithRetry({ delaysMs: [5, 15], sleep });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5, 15, 15, 15, 15]);
  });

  test('1 回目でつながれば待たない', async () => {
    const sleep = jest.fn((_ms: number) => Promise.resolve());
    await initializeAgentWithRetry({ delaysMs: [5], sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  test('失敗のたびの警告は 1・2・4・8… 回目だけ (60 秒ごとに 1 日続いてもログを埋めない)', async () => {
    for (let i = 0; i < 9; i++) (botApi.login as jest.Mock).mockRejectedValueOnce(new Error('x'));
    const sleep = jest.fn((_ms: number) => Promise.resolve());
    await initializeAgentWithRetry({ delaysMs: [1], sleep });
    const warns = (logger.warn as jest.Mock).mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[init-retry]'));
    expect(warns.map((m) => m.match(/(\d+) 回目/)?.[1])).toEqual(['1', '2', '4', '8']);
  });

  test('★ 大きなエラーの表示 (AGENT INITIALIZATION FAILED) は 1 回目だけ', async () => {
    for (let i = 0; i < 4; i++) (botApi.login as jest.Mock).mockRejectedValueOnce(new Error('x'));
    await initializeAgentWithRetry({ delaysMs: [1], sleep: () => Promise.resolve() });
    const banners = (logger.error as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('AGENT INITIALIZATION FAILED'));
    expect(banners).toHaveLength(1);
  });

  test('★ #589 パスワードの誤り (401) なら試し直さない (ログインの歯止めに当たるだけ)。.env を直すよう出す', async () => {
    (botApi.login as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Bot login failed: x'), { status: 401 }));
    const sleep = jest.fn((_ms: number) => Promise.resolve());
    const result = await initializeAgentWithRetry({ delaysMs: [1], sleep });
    expect(result.ok).toBe(false);
    expect(botApi.login).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect((logger.error as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')).toContain('.env');
  });

  test('★ #589 歯止め (429) やつながらない失敗は、今までどおり試し直す', async () => {
    (botApi.login as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error('Bot login failed: too many'), { status: 429 }))
      .mockRejectedValueOnce(new Error('fetch failed'));
    const sleep = jest.fn((_ms: number) => Promise.resolve());
    const result = await initializeAgentWithRetry({ delaysMs: [1], sleep });
    expect(result.ok).toBe(true);
    expect(botApi.login).toHaveBeenCalledTimes(3);
  });

  test('#589 試し直しが走っている間だけ「走っている」になる (webhook の側はそれを見て待つ)', async () => {
    (botApi.login as jest.Mock).mockRejectedValueOnce(new Error('fetch failed'));
    const seen: boolean[] = [];
    const sleep = jest.fn(async (_ms: number) => { seen.push(isInitInProgress()); });
    await initializeAgentWithRetry({ delaysMs: [1], sleep });
    expect(seen).toEqual([true]);
    expect(isInitInProgress()).toBe(false);
  });
});

