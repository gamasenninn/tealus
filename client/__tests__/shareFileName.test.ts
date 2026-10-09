/**
 * #527 共有で受け取ったファイルの名前。
 *
 * ★ 2026-10-09 まで、受ける段 (custom-sw.js) が中身だけを置き、画面が `shared-番号.MIME の後半` で
 *   名前を作り直していた。本番で 236 件 (動画 138・写真 90) が元の名前 (撮った日時入り) を失っていた。
 *   今は受ける段が元の名前をヘッダーに残し、画面はそれを使う。無ければ (古い受ける段) 番号の名前。
 */
import { describe, it, expect } from 'vitest';
import { sharedFileName, SHARE_NAME_HEADER } from '../src/components/share/shareFileName';

describe('sharedFileName (#527)', () => {
  it('ヘッダーの名は custom-sw.js と同じ', () => {
    expect(SHARE_NAME_HEADER).toBe('X-Share-File-Name');
  });

  it('★ 元の名前が残っていれば、それを使う', () => {
    expect(sharedFileName(encodeURIComponent('VID_20261009_101530.mp4'), 0, 'video/mp4')).toBe('VID_20261009_101530.mp4');
  });

  it('日本語の名前も戻る', () => {
    expect(sharedFileName(encodeURIComponent('見積書 (10月).pdf'), 1, 'application/pdf')).toBe('見積書 (10月).pdf');
  });

  it('★ 名前が無い (古い受ける段) なら番号の名前', () => {
    expect(sharedFileName(null, 0, 'video/mp4')).toBe('shared-0.mp4');
    expect(sharedFileName(null, 2, 'image/jpeg')).toBe('shared-2.jpg');
  });

  it('★ Excel・Word などは短い拡張子 (以前は MIME の後半がそのまま付いた)', () => {
    expect(sharedFileName(null, 0, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('shared-0.xlsx');
    expect(sharedFileName(null, 0, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('shared-0.docx');
    expect(sharedFileName(null, 0, 'application/octet-stream')).toBe('shared-0.bin');
    expect(sharedFileName(null, 0, '')).toBe('shared-0.bin');
  });

  it('壊れたヘッダー・空の名前なら番号の名前に倒す', () => {
    expect(sharedFileName('%E0%A4%A', 0, 'image/png')).toBe('shared-0.png');
    expect(sharedFileName('', 0, 'image/png')).toBe('shared-0.png');
    expect(sharedFileName(encodeURIComponent('   '), 0, 'image/png')).toBe('shared-0.png');
  });

  it('★ 名前に区切り文字があれば最後だけ (場所の指定を持ち込まない)', () => {
    expect(sharedFileName(encodeURIComponent('../../etc/a.png'), 0, 'image/png')).toBe('a.png');
    expect(sharedFileName(encodeURIComponent('C:\\Users\\x\\b.png'), 0, 'image/png')).toBe('b.png');
  });
});
