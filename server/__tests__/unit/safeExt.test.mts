/**
 * #561 保存するファイル名の拡張子は英数字だけ (10 字まで)。外れたら既定の拡張子。
 * ★ 以前は元のファイル名の拡張子 (path.extname) をそのまま保存名に付けていた (アップロード・音声・LINE の 3 か所)
 */
import { safeExt } from '../../src/utils/safeExt.mts';

test.each([
  ['photo.JPG', '.jpg'],
  ['voice.webm', '.webm'],
  ['archive.tar.gz', '.gz'],
  ['clip.mp4', '.mp4'],
])('%s → %s', (name, ext) => {
  expect(safeExt(name)).toBe(ext);
});

test.each([
  'noext',
  'weird.mp4 x',
  'a.ｍｐ４',
  'a.' + 'x'.repeat(11),
  'a.m-p4',
  'a.mp4;',
])('英数字だけでない・長すぎる拡張子は既定にする: %s', (name) => {
  expect(safeExt(name)).toBe('');
  expect(safeExt(name, '.webm')).toBe('.webm');
});

test('名前が無ければ既定', () => {
  expect(safeExt(undefined, '.bin')).toBe('.bin');
});
