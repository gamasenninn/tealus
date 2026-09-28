/**
 * 送り先 (購読) が 1 つも無い人には、未読の合計を数えない (2026-09-28)
 *
 * ★ sendPushToUser は購読の有無を見る前に、全ルームの未読合計 (バッジ用) を数えていた。
 *   送らない人の分まで数えるので、メッセージ 1 通ごとにオフラインのメンバー人数分の集計が走る。
 * ★★ テストでは購読が誰にも無いので、この集計だけが裏に残り、次のテストの TRUNCATE と
 *   デッドロックしていた (音声アップロードに通知を足した e6c65c2 以降、transcription.test が時々落ちた)。
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

import { sendPushToUser } from '../../src/services/push.mts';

const SUB = {
  id: 's1', user_id: 'u1', endpoint: 'https://push.example/x', p256dh_key: 'p', auth_key: 'a',
  device_name: 'PC', is_active: true,
};

function unreadQueries() {
  return mockQuery.mock.calls.filter(c => String(c[0]).includes('unread_count'));
}

beforeEach(() => {
  mockQuery.mockReset();
  mockSend.mockReset();
});

describe('sendPushToUser — 購読の有無', () => {
  test('★ 購読が無ければ未読を数えず、何も送らない', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await sendPushToUser('u1', { title: 't', body: 'b' });

    expect(unreadQueries()).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('購読があれば未読を数えて、合計を載せて送る', async () => {
    mockQuery.mockImplementation((sql: string) =>
      Promise.resolve(String(sql).includes('unread_count') ? { rows: [{ total: 3 }] } : { rows: [SUB] }));
    mockSend.mockResolvedValue({});

    await sendPushToUser('u1', { title: 't', body: 'b' });

    expect(unreadQueries()).toHaveLength(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSend.mock.calls[0][1]).total_unread).toBe(3);
  });
});
