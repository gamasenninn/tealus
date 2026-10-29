/**
 * Deep (codex) の知らせの投稿は、失敗しても agent-server を落とさない (2026-10-29 改善ループ 24 回目)
 *
 * ★ proc.on('close' / 'error') の中の await postTarget(...) に .catch が無く、本体へ投稿できない (再起動中・送信上限) と
 *   reject が誰にも受けられずに未処理になり、Node 24 の既定でプロセスごと終わった (監督者がいないので落ちたまま)。
 *   claude 版 (deep.mts) は #303 で直してあり、codex 版だけ取り残されていた。イベントハンドラの中なのでソースで見張る
 */
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'agents', 'deepCodex.mts'), 'utf8');

test('★ await postTarget(...) は、どれも同じ文の中で .catch を付ける', () => {
  const stmts = src.split(/;\s*\n/).filter((s) => /await postTarget\(/.test(s));
  expect(stmts.length).toBeGreaterThanOrEqual(6);
  for (const s of stmts) expect(s).toMatch(/\.catch\(/);
});
