/**
 * 文字起こしを直せる人の判定を本体で 1 つに (改善ループ 68、#649 B-2)
 *
 * ★ 以前は「直す (PUT)」と「やり直す (retranscribe)」に同じ 3 行が写してあり、10-27 に片方だけ直して翌日に取り残しを直した
 *   (d559a00e → 1896a11c)。片方を忘れると、ゲストが「やり直し」だけ通る (403 が出ないので気づけない)
 * ★ 画面 (client/src/utils/permissions.ts) と同じ形・同じ規則。別パッケージなので import せず、中身をファイルで突き合わせる
 */
import fs from 'node:fs';
import path from 'node:path';
import { canEditTranscription } from '../../src/utils/permissions.mts';

describe('canEditTranscription', () => {
  // [本人, ゲスト, 部屋の設定でメンバーも可, 送り手が機械] → 直せるか
  const table: Array<[boolean, boolean, boolean, boolean, boolean]> = [
    [true, false, false, false, true],    // 本人は直せる
    [true, true, false, false, true],     // ゲストでも本人なら直せる
    [false, false, false, false, false],  // 他の人の音声は、設定がオフなら不可
    [false, false, true, false, true],    // 設定がオンならメンバーは可
    [false, false, false, true, true],    // 機械の音声はメンバーなら可 (2026-10-24)
    [false, true, true, false, false],    // ★ ゲストは設定がオンでも他の人の音声は不可 (2026-10-27)
    [false, true, false, true, false],    // ★ ゲストは機械の音声も不可 (2026-10-27)
  ];
  it.each(table)('本人=%s ゲスト=%s 設定=%s 機械=%s → %s', (isOwn, guest, allowMemberEdit, senderIsBot, expected) => {
    expect(canEditTranscription({ isOwn, isGuest: guest, allowMemberEdit, senderIsBot })).toBe(expected);
  });

  it('★ 直す・やり直すの 2 つの口は、この関数で決める (同じ規則を手で写さない)', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, '../../src/routes/transcription.mts'), 'utf8');
    expect(src.match(/canEditTranscription\(/g)?.length).toBe(2);
    expect(src).not.toMatch(/sender_id !== userId && isGuest\(/);
  });

  it('★ 画面の写しと中身が同じ', () => {
    const body = (rel: string) => {
      const raw = fs.readFileSync(path.join(import.meta.dirname, rel), 'utf8').split(String.fromCharCode(13)).join('');
      const start = raw.indexOf('export function canEditTranscription(');
      expect(start).toBeGreaterThanOrEqual(0);
      return raw.slice(start, raw.indexOf('\n}\n', start));
    };
    expect(body('../../src/utils/permissions.mts')).toBe(body('../../../client/src/utils/permissions.ts'));
  });
});
