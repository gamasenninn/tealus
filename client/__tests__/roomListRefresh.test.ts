/**
 * 新着で部屋一覧を取り直すか (改善ループ 31)
 * ★ 管理者は全部屋の配信を受ける (見守りで入る) ので、自分の一覧に無い部屋の新着でも一覧を取り直していた。
 *   人の利用者の GET /api/rooms の 87% が管理者 1 人、1 便あたり最大 15 回
 * ★ 自分が部屋に入ったときは room:added が取り直すので、一覧に無い部屋の新着では取り直さなくてよい
 */
import { describe, it, expect } from 'vitest';
import { shouldRefreshOnNewMessage } from '../src/utils/roomListRefresh';

describe('shouldRefreshOnNewMessage', () => {
  const rooms = [{ id: 'r1' }, { id: 'r2' }];
  it('★★ 自分の一覧にある部屋の新着なら取り直す', () => {
    expect(shouldRefreshOnNewMessage('r1', rooms)).toBe(true);
  });
  it('★★ 一覧に無い部屋 (管理者の見守り) の新着では取り直さない', () => {
    expect(shouldRefreshOnNewMessage('r9', rooms)).toBe(false);
  });
  it('部屋の分からない便は今までどおり取り直す', () => {
    expect(shouldRefreshOnNewMessage(undefined, rooms)).toBe(true);
  });
  it('★ 一覧に無い部屋でも、取り直しの最中なら取り直す (招かれた直後: room:added の取り直しが新着より先に読み終わる隙間、改善ループ 32)', () => {
    expect(shouldRefreshOnNewMessage('r9', rooms, { inflight: true })).toBe(true);
  });
  it('★ 一覧に無い部屋でも、前の取り直しが失敗していたら取り直す (以前は次の新着で治っていた)', () => {
    expect(shouldRefreshOnNewMessage('r9', rooms, { failed: true })).toBe(true);
  });
});
