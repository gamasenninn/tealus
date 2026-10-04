/**
 * #494-3 (2026-10-04 UI 試験 4 周目): 入っていない部屋のアドレスを開くと、
 * 「ルーム情報の取得に失敗しました」の下に入力欄が残っていた (送ってもサーバーが黙って捨てる)
 */
import { describe, it, expect } from 'vitest';
import { showComposer } from '../src/utils/roomComposer';

describe('showComposer', () => {
  it('★ 部屋を開けなかったときは入力欄を出さない', () => {
    expect(showComposer('ルーム情報の取得に失敗しました')).toBe(false);
  });
  it('開けたときは出す', () => {
    expect(showComposer(null)).toBe(true);
  });
});
