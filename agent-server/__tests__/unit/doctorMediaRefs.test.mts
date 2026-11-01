/**
 * doctor: DB が指しているのにファイルが無い添付 (改善ループ 34)
 *
 * ★ なぜ要るか: 添付はファイル (メディアの置き場) と DB の行の 2 か所にあり、黙って食い違う。
 *   11-01 の全件の突き合わせでは 0 件だったが、確かめる口がどこにも無かった (doctor は総量と空きだけ)
 * ★ 約束: 測れなかったものを「0 件」と言わない / 1 件でも欠けていれば warn / 例は 3 件まで (中身は出さない)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judgeMediaRefs, findMissingMedia } from '../../src/lib/doctorMediaRefs.mts';

describe('judgeMediaRefs', () => {
  it('★ 欠けが無ければ info で、数えた件数を出す', () => {
    const f = judgeMediaRefs({ checked: 46957, missing: [] });
    expect(f.id).toBe('media-refs');
    expect(f.level).toBe('info');
    expect(f.detail).toMatch(/46957/);
    expect(f.detail).toMatch(/欠け 0/);
  });

  it('★★ 1 件でも欠けていれば warn。例は 3 件まで', () => {
    const f = judgeMediaRefs({ checked: 10, missing: ['images/a.jpg', 'images/b.jpg', 'voices/c.webm', 'thumbnails/d.jpg'] });
    expect(f.level).toBe('warn');
    expect(f.detail).toMatch(/欠け 4/);
    expect(f.detail).toContain('images/a.jpg');
    expect(f.detail).not.toContain('thumbnails/d.jpg');
  });

  it('★★ 測れなかったときは「0 件」と言わない', () => {
    const f = judgeMediaRefs(null);
    expect(f.level).toBe('info');
    expect(f.detail).toMatch(/確かめられませんでした/);
    expect(f.detail).not.toMatch(/欠け 0/);
  });
});

describe('findMissingMedia', () => {
  it('★ 置き場に無いパスだけを返す', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-refs-'));
    try {
      fs.mkdirSync(path.join(dir, 'images'));
      fs.writeFileSync(path.join(dir, 'images', 'here.jpg'), 'x');
      const r = findMissingMedia(dir, ['images/here.jpg', 'images/gone.jpg']);
      expect(r).toEqual({ checked: 2, missing: ['images/gone.jpg'] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
