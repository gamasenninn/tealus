/**
 * プッシュ通知の失敗を「なぜ断られたか」が分かる形でログに残す (2026-09-27)
 *
 * ★ 9/26 にロガーを直して初めて状態コードが出た —— Apple 宛ては 9/26 に 47 回、9/27 も 10 回、すべて 403。
 * ★★ ところが **Apple が返す理由 (本文の reason)** はどこにも残っていない。
 *   403 は VAPID の鍵違い・JWT の期限・subject の形など原因が複数あり、理由なしでは直し方を決められない。
 * ★ 送り先 URL は鍵のようなもの (知っていれば送れる) なので丸ごとは書かない。ホスト名と登録 id だけ。
 * ★ 403 の登録はまだ無効にしない (理由を見てから決める)。
 */
jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} }));
const mockQuery = jest.fn();
jest.mock('../../src/db/pool.mts', () => ({ pool: { query: (...a: unknown[]) => mockQuery(...a) } }));
const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: {
  setVapidDetails: jest.fn(), sendNotification: (...a: unknown[]) => mockSend(...a),
} }));

import { logger } from '../../src/utils/logger.mts';
import { sendPushToUser, describePushFailure } from '../../src/services/push.mts';

const SUB = {
  id: '11111111-2222-3333-4444-555555555555', user_id: 'u1',
  endpoint: 'https://web.push.apple.com/QSECRETTOKENxyz', p256dh_key: 'p', auth_key: 'a',
  device_name: 'iPhone', is_active: true,
};

function webPushError(statusCode: number, body: string) {
  return Object.assign(new Error('Received unexpected response code'), { statusCode, body, headers: {}, endpoint: SUB.endpoint });
}

describe('describePushFailure', () => {
  test('★★ 状態コードと、相手が返した理由 (本文) を出す', () => {
    const s = describePushFailure(webPushError(403, '{"reason":"BadJwtToken"}'), SUB);
    expect(s).toContain('status=403');
    expect(s).toContain('BadJwtToken');
    expect(s).toContain('host=web.push.apple.com');
    expect(s).toContain('sub=11111111');
    expect(s).toContain('device=iPhone');
  });
  test('★ 送り先 URL の鍵の部分は書かない', () => {
    const s = describePushFailure(webPushError(403, ''), SUB);
    expect(s).not.toContain('QSECRETTOKEN');
  });
  test('本文が長くても 200 字で切る (HTML のエラーページ等)', () => {
    const s = describePushFailure(webPushError(500, 'x'.repeat(5000)), SUB);
    expect(s.length).toBeLessThan(400);
  });
  test('状態コードの無い失敗 (通信断) は message を出す', () => {
    const s = describePushFailure(new Error('socket hang up'), SUB);
    expect(s).toContain('socket hang up');
    expect(s).toContain('status=-');
  });
});

describe('sendPushToUser の失敗', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM push_subscriptions')) return { rows: [SUB] };
      if (sql.includes('unread_count')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    });
  });

  test('★★ 403 は理由つきでログに残り、登録は無効にしない', async () => {
    mockSend.mockRejectedValue(webPushError(403, '{"reason":"BadJwtToken"}'));
    await sendPushToUser('u1', { title: 't' });
    const logged = (logger.error as jest.Mock).mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('BadJwtToken');
    expect(logged).not.toContain('QSECRETTOKEN');
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('is_active = false'))).toBe(false);
  });

  test('410 は今までどおり無効にする', async () => {
    mockSend.mockRejectedValue(webPushError(410, ''));
    await sendPushToUser('u1', { title: 't' });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('is_active = false'))).toBe(true);
  });
});
