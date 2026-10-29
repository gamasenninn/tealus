/**
 * 委譲の「このルームに投稿しないで」は、委譲先 (runAgent) と統合 (synthesize) の両方に付ける (2026-10-29 改善ループ 21 回目)
 *
 * ★ 統合 (複数の部屋の結果を 1 つにまとめる) は #295 で作ったときから一度も付いておらず、agent が自分で send_message すると
 *   委譲元の投稿と二重になった。dispatcher の内側の関数なので、配線をソースで見張る (knowledgeWiringGuard と同じ考え方)
 */
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'webhook', 'dispatcher.mts'), 'utf8');

describe('委譲の「投稿しないで」の配線', () => {
  test('★ 文面は 1 か所 (DELEGATION_NO_POST)', () => {
    expect(src).toMatch(/const DELEGATION_NO_POST = /);
    expect(src.match(/send_message ツールでこのルームに投稿しないでください/g)).toHaveLength(1);
  });

  test('★ processDeepCodex / processLightV2 の suppressAutoPost: true の呼び出しは、どれも前置きを持つ', () => {
    const calls = src.match(/process(?:DeepCodex|LightV2)\(\{[^}]*suppressAutoPost: true[^}]*\}\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);   // 委譲先 2 + 統合 2
    for (const c of calls) expect(c).toMatch(/DELEGATION_NO_POST/);
    // ★ 引数に `}` (テンプレート文字列 ${...}) を含む呼び出しは上の正規表現をすり抜ける (改善ループ 22 回目に変異で確認)。
    //   suppressAutoPost: true の数と突き合わせ、すり抜けた呼び出しがあれば落とす
    expect(calls).toHaveLength((src.match(/suppressAutoPost: true/g) ?? []).length);
  });
});
