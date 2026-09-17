/**
 * #445 — ★ 共有で「送るものが 0 件」のときに 黙って遷移しないための判定。
 *
 * ★★★★ 2026-09-17 に実際に起きたこと:
 *   LINE から動画を共有 → ルーム選択 → ★ **朝礼ルームは開くが動画は入っていない**。
 *   ★ エラーも出ないので **成功したように見える**。
 *
 * ★★ 原因 (SharePage.tsx:68-79):
 * ```
 * if (sharedContent.trim()) { 送る }        ← 空ならスキップ
 * if (sharedFiles.length > 0) { 送る }      ← 空ならスキップ
 * navigate(ルームへ)                        ← ★★★★ 何も送らずに遷移する
 * ```
 * ★★★ 原因が端末側 (LINE / Android / 空き容量) でも、★ **黙って失敗するのは直す価値がある** ——
 *   ★★ 次に同じことが起きたとき、**成功と区別がつく**ようになる。
 */
import { describe, it, expect } from 'vitest';
import { planShare } from '../src/components/share/sharePlan';

describe('planShare — ★ 何が送られるかを先に決める', () => {
  const f = (name: string) => new File(['x'], name, { type: 'video/mp4' });

  it('テキストがあれば送る', () => {
    const p = planShare('こんにちは', []);
    expect(p.willSendText).toBe(true);
    expect(p.willUpload).toBe(false);
    expect(p.nothing).toBe(false);
  });

  it('ファイルがあれば送る', () => {
    const p = planShare('', [f('a.mp4')]);
    expect(p.willSendText).toBe(false);
    expect(p.willUpload).toBe(true);
    expect(p.nothing).toBe(false);
  });

  it('両方あれば両方送る', () => {
    const p = planShare('メモ', [f('a.mp4')]);
    expect(p.willSendText).toBe(true);
    expect(p.willUpload).toBe(true);
    expect(p.nothing).toBe(false);
  });

  it('★★★★ 両方 空なら nothing = true (★ ここで遷移させない)', () => {
    const p = planShare('', []);
    expect(p.nothing).toBe(true);
    expect(p.willSendText).toBe(false);
    expect(p.willUpload).toBe(false);
  });

  it('★★ 空白だけのテキストは「無い」と同じ', () => {
    expect(planShare('   \n  ', []).nothing).toBe(true);
  });

  it('★ null / undefined で壊れない', () => {
    expect(planShare(null as unknown as string, []).nothing).toBe(true);
    expect(planShare('', null as unknown as File[]).nothing).toBe(true);
  });
});
