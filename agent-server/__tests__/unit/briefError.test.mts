/**
 * briefError テスト — 長すぎるエラー文字列を切り詰める
 *
 * 背景 (2026-08-30 実測): codex を kill すると models JSON を丸ごと含む
 * 164,976 文字のエラーが返る。それを log と「部屋への投稿」の両方で
 * 全文そのまま流していた。1 行でその日のログの 62% を占め、
 * 部屋へ投げる経路では 16 万字のメッセージが user に届く。
 */
import { briefError } from '../../src/lib/briefError.mts';

describe('briefError', () => {
  test('上限以下はそのまま返す (何も足さない)', () => {
    expect(briefError('短いエラー')).toBe('短いエラー');
  });

  test('空文字はそのまま', () => {
    expect(briefError('')).toBe('');
  });

  test('ちょうど上限はそのまま (境界)', () => {
    const s = 'a'.repeat(300);
    expect(briefError(s, 300)).toBe(s);
  });

  test('★ 切り詰めると逆に長くなる長さなら、そのまま返す (縮まないなら切らない)', () => {
    const s = 'a'.repeat(301);
    expect(briefError(s, 300)).toBe(s);
  });

  test('十分に長ければ切り詰めて全長を添える', () => {
    const s = 'a'.repeat(1000);
    const out = briefError(s, 300);
    expect(out.startsWith('a'.repeat(300))).toBe(true);
    expect(out).toContain('全長 1000 文字');
    expect(out.length).toBeLessThan(s.length);
  });

  test('★ どんな入力でも元より長くならない', () => {
    for (const n of [0, 1, 299, 300, 301, 310, 320, 5000]) {
      const s = 'a'.repeat(n);
      expect(briefError(s, 300).length).toBeLessThanOrEqual(s.length);
    }
  });

  test('★ 16 万字級でも短く収まる (実測ケース)', () => {
    const huge = 'Codex Exec exited with code 4294967295: ' + 'x'.repeat(164_936);
    const out = briefError(huge);
    expect(out.length).toBeLessThan(400);
    expect(out).toContain('Codex Exec exited with code 4294967295');
    expect(out).toContain('全長 164976 文字');
  });

  test('max を指定できる (部屋へ投げるときは長めに取る等)', () => {
    const s = 'b'.repeat(1000);
    expect(briefError(s, 500).startsWith('b'.repeat(500))).toBe(true);
    expect(briefError(s, 50).startsWith('b'.repeat(50))).toBe(true);
  });

  test('切り詰めても先頭は必ず残る (原因の手がかりを消さない)', () => {
    const s = 'ENOENT: no such file or directory, open ' + 'z'.repeat(9999);
    expect(briefError(s)).toContain('ENOENT: no such file or directory');
  });
});
