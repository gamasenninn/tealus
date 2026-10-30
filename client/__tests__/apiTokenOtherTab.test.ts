/**
 * 鍵の切れた古いタブが、別のタブで入り直した人の鍵を消さない (2026-10-30 小野さん判断 D)
 * ★ 鍵は同じブラウザのタブで共有 (localStorage)。古いタブが 401 でログアウトすると、別のタブで入り直した新しい鍵まで消し、
 *   そちらも次の起動でログアウトされた
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { api } from '../src/services/api';

describe('api.setToken(null) は自分の鍵だけ消す', () => {
  beforeEach(() => localStorage.clear());

  it('★★ 保存されている鍵が別のタブの新しい鍵なら消さない', () => {
    api.setToken('old');
    localStorage.setItem('token', 'new');   // 別のタブで入り直した
    api.setToken(null);
    expect(localStorage.getItem('token')).toBe('new');
    expect(api.token).toBeNull();
  });

  it('自分の鍵なら消す (ふつうのログアウト)', () => {
    api.setToken('mine');
    api.setToken(null);
    expect(localStorage.getItem('token')).toBeNull();
  });
});
