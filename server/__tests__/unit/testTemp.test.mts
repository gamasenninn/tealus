/** ★ #576 テストの一時フォルダの後片づけ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { cleanTestTemp } = createRequire(import.meta.url)('../helpers/testTemp.js');

test('★ 自分の pid の分と 1 日以上前の分だけ消す (他の名前・走っている最中の分は残す)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
  const mk = (name: string, ageMs: number, isDir = true) => {
    const p = path.join(dir, name);
    if (isDir) fs.mkdirSync(p); else fs.writeFileSync(p, 'x');
    const t = (Date.now() - ageMs) / 1000;
    fs.utimesSync(p, t, t);
  };
  mk('tealus-test-media-111', 0);                       // 自分
  mk('tealus-test-media-222', 2 * 86400000);            // 2 日前に残された分
  mk('tealus-test-media-333', 60000);                   // 別のテストが走っている最中
  mk('tealus-test-dictionary.local.111.ttl', 0, false); // 自分
  mk('other-folder', 5 * 86400000);                     // 関係ないもの
  const removed = cleanTestTemp(dir, 111);
  expect(removed.sort()).toEqual(['tealus-test-dictionary.local.111.ttl', 'tealus-test-media-111', 'tealus-test-media-222']);
  expect(fs.readdirSync(dir).sort()).toEqual(['other-folder', 'tealus-test-media-333']);
  fs.rmSync(dir, { recursive: true, force: true });
});
