/**
 * v0.11.0 のリリース前チェック (2026-10-15): migrate を忘れて再起動すると、removed_media (040) が無いので
 * isMediaHidden が毎回失敗し、/media の画像・音声・サムネイルが全部 500 になっていた。
 * ★ 表が無いとき (42P01) は #601 の判定 (削除した投稿だけが使っている添付を隠す) に退き、
 *   「migrate してください」を 1 回だけ warn する。隠す働きは #601 の分だけ残る
 */
import { isMediaHidden } from '../../src/services/deletedMedia.mts';

function fakeDb(row: { used: number; live: boolean | null }) {
  const calls: string[] = [];
  return {
    calls,
    async query<R extends object>(text: string): Promise<{ rows: R[] }> {
      calls.push(text);
      if (text.includes('removed_media')) {
        throw Object.assign(new Error('relation "removed_media" does not exist'), { code: '42P01' });
      }
      return { rows: [row as unknown as R] };
    },
  };
}

describe('isMediaHidden — removed_media が無いとき (migrate 忘れ)', () => {
  it('★★ 投げずに #601 の判定へ退く: 削除した投稿だけが使っている添付は隠す', async () => {
    const db = fakeDb({ used: 1, live: false });
    await expect(isMediaHidden('images/a.png', db)).resolves.toBe(true);
  });

  it('★★ 生きている投稿の添付・表に無いファイルは開ける (全部 500 にしない)', async () => {
    await expect(isMediaHidden('images/b.png', fakeDb({ used: 1, live: true }))).resolves.toBe(false);
    await expect(isMediaHidden('avatars/x.png', fakeDb({ used: 0, live: null }))).resolves.toBe(false);
  });

  it('★ 表が無いこと以外の失敗は今までどおり投げる (判定できないときは開かせない)', async () => {
    const db = {
      async query(): Promise<never> { throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }); },
    };
    await expect(isMediaHidden('images/a.png', db)).rejects.toThrow(/connection refused/);
  });
});

/**
 * v0.11.0 の監査: 040 が無いと、部屋の削除の中の rememberRoomMedia が INSERT で失敗し、トランザクションごと
 * ROLLBACK → どの部屋も削除できなかった (500)。★ トランザクションの中で失敗すると後が続かないので、
 * 投げる前に表の有無を確かめ、無ければ記録を飛ばして warn (削除は通す)
 */
import { rememberRoomMedia } from '../../src/services/deletedMedia.mts';

describe('rememberRoomMedia — removed_media が無いとき', () => {
  it('★★ 表が無ければ INSERT を投げずに戻る (部屋の削除を止めない)', async () => {
    const calls: string[] = [];
    const db = {
      async query<R extends object>(text: string): Promise<{ rows: R[] }> {
        calls.push(text);
        if (text.includes('to_regclass')) return { rows: [{ t: null } as unknown as R] };
        throw new Error('INSERT を投げてはいけない');
      },
    };
    await expect(rememberRoomMedia('room-1', db)).resolves.toBeUndefined();
    expect(calls.some((c) => c.includes('INSERT'))).toBe(false);
  });

  it('表があれば今までどおり記録する', async () => {
    const calls: string[] = [];
    const db = {
      async query<R extends object>(text: string): Promise<{ rows: R[] }> {
        calls.push(text);
        if (text.includes('to_regclass')) return { rows: [{ t: 'removed_media' } as unknown as R] };
        return { rows: [] };
      },
    };
    await rememberRoomMedia('room-1', db);
    expect(calls.some((c) => c.includes('INSERT INTO removed_media'))).toBe(true);
  });
});
