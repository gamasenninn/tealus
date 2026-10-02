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

// #463 機械の投稿の通知は別の関数 (machinePush) の仕事。ここでは「正しい引数で呼ぶか」だけを見る
//   (ルームの設定を引く問い合わせは machinePush 側。この単体テストの「2 回だけ」を崩さない)
const mockPushMachinePost = jest.fn((..._a: unknown[]) => Promise.resolve());
jest.mock('../../src/services/machinePush.mts', () => ({
  ...jest.requireActual('../../src/services/machinePush.mts'),
  pushMachinePost: (...a: unknown[]) => mockPushMachinePost(...a),
}));

// ★ リンクプレビューは外へ取りに行く。ここでは「正しい引数で呼ぶか」だけを見る (2026-10-02 #383 第 2 段で付けた)
const mockProcessLinkPreviews = jest.fn((..._a: unknown[]) => Promise.resolve());
jest.mock('../../src/services/linkPreview.mts', () => ({
  processLinkPreviews: (...a: unknown[]) => mockProcessLinkPreviews(...a),
}));

jest.mock('../../src/utils/logger.mts', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { postAsUser } from '../../src/services/postAsUser.mts';
import { logger } from '../../src/utils/logger.mts';

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
  (logger.warn as jest.Mock).mockReset();
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

  /**
   * ★ #383 段階 1 (2026-10-01): 付随処理を announcePost へ移す前に、**送る中身と順番**を固定する。
   *   上のテストは webhook の中身を `expect.anything()` で見ているので、中身が変わっても通ってしまう
   *   (エージェントは webhook の中身で動くので、ここが変わると画面は正常なまま AI だけが変わる)
   */
  test('★ 送る中身と順番: 配信 → 機械の通知 (待つ) → webhook', async () => {
    happyPath();
    const order: string[] = [];
    mockEmit.mockImplementation(() => { order.push('emit'); });
    mockPushMachinePost.mockImplementation(async () => { order.push('machine:start'); await Promise.resolve(); order.push('machine:end'); });
    mockFireWebhooks.mockImplementation(() => { order.push('webhook'); });

    const r = await postAsUser({ roomId: ROOM, sender: SENDER, content: '  hi  ', type: 'text' });
    expect(r.ok).toBe(true);
    expect(order).toEqual(['emit', 'machine:start', 'machine:end', 'webhook']);
    expect(mockEmit).toHaveBeenCalledWith('message:new', {
      ...MESSAGE, sender_display_name: 'テスト太郎', sender_avatar_url: null,
    });
    expect(mockPushMachinePost).toHaveBeenCalledWith({
      roomId: ROOM, senderId: USER, senderName: 'テスト太郎', messageId: 'msg-1', body: 'hi',
    });
    expect(mockFireWebhooks).toHaveBeenCalledWith('message.created', ROOM, {
      room: { id: ROOM },
      message: { id: 'msg-1', type: 'text', content: 'hi', reply_to: null, sender: { id: USER, display_name: 'テスト太郎' } },
    });
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockFireWebhooks).toHaveBeenCalledTimes(1);
    mockPushMachinePost.mockReset().mockImplementation(() => Promise.resolve()); // ★ 後のテストに順番の記録を残さない
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

  /**
   * #451 弾いた投稿を **記録する**。
   *
   * ★ 2026-09-21 の実害: `POST /api/bot/push` が 403 を 3 本返したが、
   *   アクセスログには `POST /api/bot/push 403 2ms` しか残らず、**誰が・どの部屋に**
   *   出そうとしたのか分からなかった。★★ room_id は body にあるので path にも出ない。
   * ★★★ 結果、こちらが名義を推定で埋めて外し、他班との切り分けが 1 日止まった。
   *
   * ★★★★ ここ (postAsUser) に置く理由: not_member を決めているのがここ 1 か所で、
   *   bot push と ルームトリガー の**両方**が通る。呼び出し側に書くと片方だけ直る。
   */
  test('★★★★ 非メンバーで弾いたら actor と room を warn に残す (#451)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });

    const warned = (logger.warn as jest.Mock).mock.calls.map(c => String(c[0]));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(USER);            // ★ 誰が (id — 表示名は変わりうる)
    expect(warned[0]).toContain('テスト太郎');      // ★ 誰が (人が読む側)
    expect(warned[0]).toContain(ROOM);            // ★★ どの部屋に
  });

  test('★ 投稿が通ったときは warn を出さない (雑音にしない)', async () => {
    happyPath();
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(logger.warn).not.toHaveBeenCalled();
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

/**
 * ★ 2026-09-21 13:44 に、出品業務の Claude Code の投稿が 500 で落ちた:
 *   `invalid byte sequence for encoding "UTF8": 0x00` —— 本文に NUL 文字が混ざっていた。
 *   PostgreSQL の text は NUL を保存できない。送り手が 15 秒後に出し直して救われたが、
 *   NUL は目に見えないので、送り手 (機械) には何が悪いのか分からない。
 * → 保存前に取り除き、取り除いたことはログに残す (黙って直さない)。
 */
describe('postAsUser — 本文の NUL 文字', () => {
  test('★★ NUL を取り除いて保存し、成功する', async () => {
    happyPath();
    const r = await postAsUser({ roomId: ROOM, sender: SENDER, content: '完了\u0000 36 枚' });
    expect(r.ok).toBe(true);
    const insertArgs = mockQuery.mock.calls[1][1] as unknown[];
    expect(insertArgs[2]).toBe('完了 36 枚');
    const hook = mockFireWebhooks.mock.calls[0][2] as { message: { content: string } };
    expect(hook.message.content).toBe('完了 36 枚');
  });

  test('★ 取り除いたことをログに残す (誰の・何文字)', async () => {
    happyPath();
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'a\u0000b\u0000' });
    const warned = (logger.warn as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('NUL');
    expect(warned).toContain('2');
    expect(warned).toContain('テスト太郎');
  });

  test('NUL だけの本文は空として断る', async () => {
    const r = await postAsUser({ roomId: ROOM, sender: SENDER, content: '\u0000\u0000' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('empty_content');
  });

  test('NUL が無ければログを出さない', async () => {
    happyPath();
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('postAsUser — 機械の投稿の通知 (#463)', () => {
  beforeEach(() => { mockQuery.mockReset(); mockPushMachinePost.mockClear(); });

  it('投稿が通ったら、送り手・本文の先頭で通知の関数を呼ぶ (鳴らすかどうかはその中でルームの設定を見る)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }).mockResolvedValueOnce({ rows: [MESSAGE] });
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(mockPushMachinePost).toHaveBeenCalledWith({ roomId: ROOM, senderId: USER, senderName: 'テスト太郎', messageId: 'msg-1', body: 'hi' });
  });

  it('メンバーでなければ呼ばない', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(mockPushMachinePost).not.toHaveBeenCalled();
  });
});

/**
 * ★ #383 第 2 段 (2026-10-02 利用者判断): ボットのテキストにもリンクプレビューを付ける。
 *   それまでは「不明」で付いていなかった (付くのは #1 と #13 だけ)。
 *   ★ #1 と同じく text のときだけ。待たずに投げる (投稿は OGP の取得を待たない)
 */
describe('postAsUser — リンクプレビュー', () => {
  beforeEach(() => { mockQuery.mockReset(); mockProcessLinkPreviews.mockClear(); });

  it('★ text なら、空白を落とした本文でプレビューを呼ぶ (配信と同じ io・同じ部屋)', async () => {
    const msg = { ...MESSAGE, content: '見て https://example.com/a' };
    mockQuery.mockResolvedValueOnce({ rows: [{ ok: 1 }] }).mockResolvedValueOnce({ rows: [msg] });
    await postAsUser({ roomId: ROOM, sender: SENDER, content: '  見て https://example.com/a  ' });
    expect(mockProcessLinkPreviews).toHaveBeenCalledTimes(1);
    const [id, text, io, room] = mockProcessLinkPreviews.mock.calls[0];
    expect([id, text, room]).toEqual(['msg-1', '見て https://example.com/a', ROOM]);
    expect((io as { to: unknown }).to).toBe(mockTo);
  });

  it('★ text 以外 (フォームなど) には付けない', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ok: 1 }] }).mockResolvedValueOnce({ rows: [{ ...MESSAGE, type: 'form' }] });
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'https://example.com/a', type: 'form' });
    expect(mockProcessLinkPreviews).not.toHaveBeenCalled();
  });

  it('★ 順番は入口のとおり: 配信 → 機械の通知 → AI 通知 → プレビュー', async () => {
    happyPath();
    const order: string[] = [];
    mockEmit.mockImplementation(() => { order.push('emit'); });
    mockPushMachinePost.mockImplementation(async () => { order.push('machine'); });
    mockFireWebhooks.mockImplementation(() => { order.push('webhook'); });
    mockProcessLinkPreviews.mockImplementation(async () => { order.push('preview'); });
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'hi' });
    expect(order).toEqual(['emit', 'machine', 'webhook', 'preview']);
    mockPushMachinePost.mockReset().mockImplementation(() => Promise.resolve());
    mockProcessLinkPreviews.mockReset().mockImplementation(() => Promise.resolve());
  });

  it('メンバーでなければ呼ばない', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await postAsUser({ roomId: ROOM, sender: SENDER, content: 'https://example.com/a' });
    expect(mockProcessLinkPreviews).not.toHaveBeenCalled();
  });
});
