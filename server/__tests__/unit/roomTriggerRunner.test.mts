/**
 * ルームトリガー: 1 周ぶんの実行 (#382 第 1 段)
 *
 * ★ runOnce は DB も時計も外から受ける。ポーリングの器 (setInterval) だけが別。
 * ★★ ここで固定するのは docs/06 §6 の残り:
 *   - 1 件が壊れても他が止まらない
 *   - 撃たなかったことが記録に残る (沈黙にしない)
 *   - 投稿の本文は buildBody (印が 2 行目) を通ったものであること
 */
import type { SenderContext } from '../../src/services/postAsUser.mts';
import { loadTriggersFrom } from '../../src/services/roomTriggers.mts';
import { runOnce, shouldReport } from '../../src/services/roomTriggerRunner.mts';

const ROOM = 'c698839a-25fb-44e3-9646-d71fce43cdc5';
const USER = '353c1076-5241-4542-bca8-9b259c47e5de';
const SENDER: SenderContext = { id: USER, display_name: '小野哲', avatar_url: null };
const POSTED = { id: 'm1', room_id: ROOM, sender_id: USER, content: 'go', type: 'text' };

const rawTrigger = {
  id: 'chourei', room_id: ROOM, room: '朝礼', types: ['video'], when: 'immediate',
  message: '@アシスタント /light この動画から議事録を作成して',
  as_user_id: USER, enabled: true, description: '',
};

function deps(over: Record<string, unknown> = {}) {
  return {
    now: new Date('2026-08-23T01:40:00Z'),
    lastFiredAt: jest.fn(async () => null),
    latestMatchAt: jest.fn(async () => new Date('2026-08-23T01:38:00Z')),
    resolveSender: jest.fn(async () => SENDER),
    post: jest.fn(async (_input: { roomId: string; sender: SenderContext; content: string }) =>
      ({ ok: true as const, message: POSTED })),
    ...over,
  };
}

const load = (rows: unknown[]) => loadTriggersFrom(rows).triggers;

describe('runOnce', () => {
  test('撃つべきときに投稿する', async () => {
    const d = deps();
    const results = await runOnce(load([rawTrigger]), d);
    expect(d.post).toHaveBeenCalledTimes(1);
    expect(results[0].fired).toBe(true);
  });

  test('★ 本文は 1 行目が message、2 行目が印', async () => {
    const d = deps();
    await runOnce(load([rawTrigger]), d);
    const arg = d.post.mock.calls[0][0] as { content: string };
    expect(arg.content.split('\n')).toEqual([
      '@アシスタント /light この動画から議事録を作成して',
      '— 自動投稿 (room-triggers: chourei)',
    ]);
  });

  test('設定した人の名義で投稿する', async () => {
    const d = deps();
    await runOnce(load([rawTrigger]), d);
    const arg = d.post.mock.calls[0][0] as { sender: { id: string } };
    expect(arg.sender.id).toBe(USER);
  });

  test('撃たないときは post を呼ばない', async () => {
    const d = deps({ latestMatchAt: jest.fn(async () => null) });
    const results = await runOnce(load([rawTrigger]), d);
    expect(d.post).not.toHaveBeenCalled();
    expect(results[0].fired).toBe(false);
  });

  test('★ 撃たなかった理由が結果に残る (沈黙にしない)', async () => {
    const d = deps({ latestMatchAt: jest.fn(async () => null) });
    const results = await runOnce(load([rawTrigger]), d);
    expect(results[0].reason).toContain('投稿なし');
  });

  test('★ 1 件が例外を投げても、他のトリガーは走る', async () => {
    const other = { ...rawTrigger, id: 'other' };
    const lastFiredAt = jest.fn(async (t: { id: string }) => {
      if (t.id === 'chourei') throw new Error('boom');
      return null;
    });
    const d = deps({ lastFiredAt });
    const results = await runOnce(load([rawTrigger, other]), d);
    expect(results).toHaveLength(2);
    expect(results[0].error).toContain('boom');
    expect(results[1].fired).toBe(true);
  });

  test('★ 投稿に失敗しても例外にせず、理由を残す', async () => {
    const d = deps({
      post: jest.fn(async () => ({ ok: false as const, code: 'not_member', reason: 'メンバーではありません' })),
    });
    const results = await runOnce(load([rawTrigger]), d);
    expect(results[0].fired).toBe(false);
    expect(results[0].error).toContain('メンバー');
  });

  test('名義の user が引けなければ投稿しない', async () => {
    const d = deps({ resolveSender: jest.fn(async () => null) });
    const results = await runOnce(load([rawTrigger]), d);
    expect(d.post).not.toHaveBeenCalled();
    expect(results[0].error).toContain(USER);
  });

  test('enabled: false は判定まで進むが投稿しない', async () => {
    const d = deps();
    const results = await runOnce(load([{ ...rawTrigger, enabled: false }]), d);
    expect(d.post).not.toHaveBeenCalled();
    expect(results[0].reason).toContain('無効');
  });

  test('★ enabled: false なら DB も引かない (無効な行で毎回 2 クエリ投げない)', async () => {
    const d = deps();
    await runOnce(load([{ ...rawTrigger, enabled: false }]), d);
    expect(d.lastFiredAt).not.toHaveBeenCalled();
    expect(d.latestMatchAt).not.toHaveBeenCalled();
  });

  test('トリガーが 0 件でも落ちない', async () => {
    expect(await runOnce([], deps())).toEqual([]);
  });
});

describe('shouldReport — 10 秒ごとの行でログを埋めない', () => {
  const t0 = new Date('2026-08-23T01:00:00Z');

  test('発火は必ず出す', () => {
    expect(shouldReport({ fired: true, reason: 'x' }, { reason: 'x', at: t0 }, t0)).toBe(true);
  });

  test('理由が変わったら出す (状態が動いた合図)', () => {
    expect(shouldReport({ fired: false, reason: 'b' }, { reason: 'a', at: t0 }, t0)).toBe(true);
  });

  test('同じ理由が続く間は出さない', () => {
    const t1 = new Date(t0.getTime() + 60_000);
    expect(shouldReport({ fired: false, reason: 'a' }, { reason: 'a', at: t0 }, t1)).toBe(false);
  });

  test('★ ただし 1 時間に 1 回は必ず出す (生きていることを沈黙で表さない)', () => {
    const t1 = new Date(t0.getTime() + 3_600_000);
    expect(shouldReport({ fired: false, reason: 'a' }, { reason: 'a', at: t0 }, t1)).toBe(true);
  });

  test('初回は必ず出す', () => {
    expect(shouldReport({ fired: false, reason: 'a' }, undefined, t0)).toBe(true);
  });
});
