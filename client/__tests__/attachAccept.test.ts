/**
 * #497 ＋ボタンのファイル選択で CSV・Markdown・JSON が選べなかった。
 * プレビュー (TextFilePreview) はこれらに対応しているので、選べる種類にも入れる
 */
import { describe, it, expect } from 'vitest';
import { ATTACH_ACCEPT } from '../src/constants/ui';

describe('ATTACH_ACCEPT', () => {
  it.each(['.csv', '.md', '.json'])('★ %s を選べる', (ext) => {
    expect(ATTACH_ACCEPT.split(',')).toContain(ext);
  });
  it('今まで選べたものはそのまま', () => {
    for (const x of ['image/*', 'video/*', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt']) {
      expect(ATTACH_ACCEPT.split(',')).toContain(x);
    }
  });
});
