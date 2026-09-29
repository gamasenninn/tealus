/**
 * #476 トーク画面で日付の頭へ飛ぶ — 日ごとにまとめる / その日の最初の投稿へ飛ぶ
 *
 * ★ 日付の札を position: sticky で上に貼り付けるには、札が「その日のまとまり」の直下に要る。
 *   以前は札が投稿 1 件の枠の中にあり、その 1 件と一緒に画面の外へ流れていた
 */
import { describe, it, expect, vi } from 'vitest';
import { groupByDay, localDayKey, jumpToDate } from '../src/utils/dateJump';

// 画面の時刻で日を区切る。テストは JST (TZ=Asia/Tokyo を前提にしない) ので、ローカル時刻で作る
const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).toISOString();

describe('localDayKey', () => {
  it('見ている人の時刻での YYYY-MM-DD', () => {
    expect(localDayKey(at(2026, 9, 3, 0))).toBe('2026-09-03');
    expect(localDayKey(at(2026, 9, 3, 23))).toBe('2026-09-03');
  });
});

describe('groupByDay', () => {
  it('★ 同じ日の投稿を 1 つのまとまりにし、日付の順を保つ', () => {
    const msgs = [
      { id: 'a', created_at: at(2026, 9, 11, 9) },
      { id: 'b', created_at: at(2026, 9, 11, 18) },
      { id: 'c', created_at: at(2026, 9, 12, 8) },
    ];
    const groups = groupByDay(msgs);
    expect(groups.map((g) => g.day)).toEqual(['2026-09-11', '2026-09-12']);
    expect(groups.map((g) => g.messages.map((m) => m.id))).toEqual([['a', 'b'], ['c']]);
    expect(groups[0].firstCreatedAt).toBe(msgs[0].created_at);
  });

  it('空なら空', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('★ 日をまたいで戻る並び (読み足しの途中など) でも、隣り合う同じ日だけをまとめる (並びは変えない)', () => {
    const msgs = [
      { id: 'a', created_at: at(2026, 9, 11) },
      { id: 'b', created_at: at(2026, 9, 12) },
      { id: 'c', created_at: at(2026, 9, 11) },
    ];
    expect(groupByDay(msgs).map((g) => g.messages.map((m) => m.id))).toEqual([['a'], ['b'], ['c']]);
  });
});

describe('jumpToDate', () => {
  it('★ その日の最初の投稿を引いて、message:scroll-to を投げる (#256 の仕組みで飛ぶ)', async () => {
    const getFirst = vi.fn().mockResolvedValue({ message_id: 'm-first' });
    const dispatch = vi.fn();
    const ok = await jumpToDate('room1', '2026-09-12', { getFirst, dispatch });
    expect(ok).toBe(true);
    expect(getFirst).toHaveBeenCalledWith('room1', '2026-09-12');
    expect(dispatch).toHaveBeenCalledWith('m-first');
  });

  it('投稿の無い日なら何もしないで false', async () => {
    const dispatch = vi.fn();
    const ok = await jumpToDate('room1', '2026-09-20', { getFirst: vi.fn().mockResolvedValue({ message_id: null }), dispatch });
    expect(ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('取りに行って失敗しても投げない (false)', async () => {
    const dispatch = vi.fn();
    const ok = await jumpToDate('room1', '2026-09-12', { getFirst: vi.fn().mockRejectedValue(new Error('x')), dispatch });
    expect(ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
