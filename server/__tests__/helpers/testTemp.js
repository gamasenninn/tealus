/**
 * ★ #576 テストの一時フォルダ・ファイルの後片づけ。
 *
 * jest.setup.js は MEDIA_ROOT / LOCAL_TTL_PATH を os.tmpdir() の `tealus-test-*-<pid>` に向けるが、
 * 消す処理が無く、2026-10-11 に 359 フォルダ / 547 MB たまっていた (開発日は 1 日 30〜76 個)。
 * 自分の pid の分と、1 日以上前に残された分を消す (別のテストが走っている最中の分は消さない)。
 */
const fs = require('fs');
const path = require('path');

const PATTERN = /^tealus-test-(media-\d+|dictionary\.local\.\d+\.ttl)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function cleanTestTemp(dir, pid, now = Date.now()) {
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    if (!PATTERN.test(name)) continue;
    const full = path.join(dir, name);
    const mine = name === `tealus-test-media-${pid}` || name === `tealus-test-dictionary.local.${pid}.ttl`;
    let stale = false;
    try { stale = now - fs.statSync(full).mtimeMs > DAY_MS; } catch { continue; }
    if (!mine && !stale) continue;
    try { fs.rmSync(full, { recursive: true, force: true }); removed.push(name); } catch { /* 使用中などは次回 */ }
  }
  return removed;
}

module.exports = { cleanTestTemp };
