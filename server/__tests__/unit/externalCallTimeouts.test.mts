/**
 * 外へ出る呼び出しに、こちらで決めた時間切れを付ける (改善ループ 10 回目の F、2026-10-23)
 *
 * ★ 文字起こし・整形の OpenAI は SDK の既定 (10 分 × やり直し 2 回 = 最長 30 分) のまま、web-push は時間切れ無しだった。
 *   相手が固まると、音声は「文字起こし中」のまま 30 分、通知は送り終わらないまま残る (実例はまだ無い)
 */
// ★ import は巻き上がるので、記録の器は mock の中で作る (docs/05 §2a の TDZ)
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation((opts: unknown) => {
  ((globalThis as Record<string, unknown>).__openaiCtorArgs ??= [] as unknown[]) as unknown[];
  ((globalThis as Record<string, unknown>).__openaiCtorArgs as unknown[]).push(opts);
  return { audio: { transcriptions: { create: jest.fn() } }, chat: { completions: { create: jest.fn() } } };
}) }));
const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: {
  setVapidDetails: jest.fn(), sendNotification: (...a: unknown[]) => mockSend(...a),
} }));

import '../../src/services/transcription.mts';
import '../../src/services/formatting.mts';
import { sendPushToUser } from '../../src/services/push.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

test('文字起こし・整形の OpenAI は 2 分で切る・やり直しは 1 回まで', () => {
  const ctorArgs = ((globalThis as Record<string, unknown>).__openaiCtorArgs ?? []) as unknown[];
  expect(ctorArgs.length).toBeGreaterThanOrEqual(2);
  for (const a of ctorArgs) {
    expect(a).toEqual(expect.objectContaining({ timeout: 120_000, maxRetries: 1 }));
  }
});

describe('web-push', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => { await cleanTestDb(); mockSend.mockReset(); mockSend.mockResolvedValue({}); });

  test('通知の送信は 10 秒で切る', async () => {
    const me = (await createTestUser({ login_id: 'EMP401', display_name: '受け手' })).user;
    await getTestPool().query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES ($1, 'https://push.example/x', 'p', 'a')`, [me.id]);
    await sendPushToUser(me.id, { title: 't', body: 'b' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][2]).toEqual(expect.objectContaining({ timeout: 10_000 }));
  });
});
