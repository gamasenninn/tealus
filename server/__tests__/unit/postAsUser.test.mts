/**
 * 投稿の共通関数 (#382)
 *
 * ★ 新しい投稿経路を作らない (docs/06 §3.3)。POST /api/bot/push が持っていた
 *   「メンバー確認 → INSERT → socket 配信 → webhook」を切り出して、
 *   トリガーからも HTTP を経由せず同じものを呼ぶ。
 *
 * ★★ 4 つが揃っていることをテストで固定する。1 つでも欠けると:
 *   メンバー確認  → 名義の妥当性検査が消える
 *   socket 配信   → 画面が更新されず未読も数え直されない (§3.3)
 *   webhook       → **エージェントが起動しない** = 機能そのものが動かない
 *
 * ★★★ sender は呼び出し側が context object で渡す (docs/05 §4 の既存の約束)。
 *   helper の中で users を引かない = テストが DB から独立し、モジュール状態がゼロになる。
 */
const mockQuery = jest.fn();
jest.mock('../../src/db/pool.mts', () => ({ pool: { query: (...a: unknown[]) => mockQuery(...a) } }));

const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));
jest.mock('../../src/io-registry.mts', () => ({ getIo: () => ({ to: mockTo }) }));

const mockFireWebhooks = jest.fn();
jest.mock('../../src/services/webhook.mts', () => ({
  fireWebhooks: (...a: unknown[]) => mockFireWebhooks(...a),
}));

jest.mock('../../src/utils/logger.mts', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { postAsUser } from '../../src/services/postAsUser.mts';

const ROOM = '00000000-0000-0000-0000-000000000002';
const USER = '00000000-0000-0000-0000-000000000001';
const SENDER = { id: USER, display_name: 'テスト太郎', avatar_url: null };
const MESSAGE = { id: 'msg-1', room_id: ROOM, sender_id: USER, content: 'hi', type: 'text' };

/** メンバーである / INSERT 成功 の既定並び */
function happyPath() {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ ok: 1 }] })   // メンバー確認
    .mockResolvedValueOnce({ rows: [MESSAGE] });    // INSERT
}

beforeEach(() => {
  mockQuery.mockReset();
  mockEmit.mockReset();
  mockTo.mockReset().mockReturnValue({ emit: mockEmit });
  mockFireWebhooks.mockReset();
});

describe('postAsUser', () => {
  test('4 つ全部やる: メンバー確認 → INSERT → 配信 → webhook', async () => {
    happyPath();
    const r = await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(r.ok).toBe(true);
    expect(mockTo).toHaveBeenCalledWith(ROOM);
    expect(mockEmit).toHaveBeenCalledWith('message:new', expect.objectContaining({ id: 'msg-1' }));
    expect(mockFireWebhooks).toHaveBeenCalledWith('message.created', ROOM, expect.anything());
  });

  test('★ 非メンバーなら投稿しない (名義の妥当性検査)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_member');
    expect(mockFireWebhooks).not.toHaveBeenCalled();
  });

  test('★ 非メンバーのときは INSERT も走らない', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('★ users を引かない (DB query はメンバー確認と INSERT の 2 回だけ)', async () => {
    happyPath();
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('★ 配信には表示名を載せる (画面が「不明なユーザー」にならない)', async () => {
    happyPath();
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(mockEmit).toHaveBeenCalledWith(
      'message:new', expect.objectContaining({ sender_display_name: 'テスト太郎' }),
    );
  });

  test('webhook にも sender を載せる (エージェントが誰の発言か分かる)', async () => {
    happyPath();
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    const payload = mockFireWebhooks.mock.calls[0][2] as { message: { sender: { id: string } } };
    expect(payload.message.sender.id).toBe(USER);
  });

  test('空の本文は投稿しない', async () => {
    const r = await postAsUser({ roomId: ROOM, sender: SENDER, content: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('empty_content');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('★ 改行を含む本文をそのまま入れる (印は 2 行目にある)', async () => {
    happyPath();
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'go\n— 自動投稿 (room-triggers: t)' });
    const insertArgs = mockQuery.mock.calls[1][1] as string[];
    expect(insertArgs[2]).toBe('go\n— 自動投稿 (room-triggers: t)');
  });

  test('★ 前後の空白だけ落とす。中の改行は潰さない', async () => {
    happyPath();
    await postAsUser({ roomId: ROOM, sender: SENDER, content: '  go\nmark  ' });
    expect((mockQuery.mock.calls[1][1] as string[])[2]).toBe('go\nmark');
  });

  test('DB が落ちたら ok:false を返す (投げっぱなしにしない)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const r = await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('error');
  });
});
