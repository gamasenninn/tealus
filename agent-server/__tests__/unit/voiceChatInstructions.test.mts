/**
 * ★★★★★ 会話モードの instructions に organon と業務語彙を載せる (2026-09-13、#437)
 *
 * ## なぜ変えるのか
 *
 * ★ 利用者の指摘: **「ルームの会話精度と会話モードの精度があまりにも違いすぎる」**。
 * ★★ 実物を読んだら、**会話モードだけが organon も辞書も受け取っていなかった**:
 *
 * ```
 * Light v1 / v2      loadOrganonPolysemeForPrompt() + loadVocabForPrompt() を自分で呼ぶ
 * Deep / DeepCodex   dispatcher の buildDeepPrompt() が呼ぶ
 * ★★★ 会話モード      別ルート (routes/voiceChat.mts)。★ どちらも呼んでいない
 * ```
 *
 * ## 外していた理由は、実測で当てはまらなくなった
 *
 * ```
 * ★ 当時の根拠   「既存経路が毎ターン約 96,000 tokens = 遅さの正体」(docs/08 §2.4)
 * ★★ 実測 (2026-09-13)
 *    organon polyseme  21.8 KB (8 entries)
 *    業務語彙          13.8 KB (214 行)   ← ★ 57 KB ではない (alias を持つ語だけ)
 *    light_prompt       8.8 KB           ← ★★ 「小さいから」として既に戻してある
 * ★★★ そして速さの基準は **もう満たしていない** ——
 *    53 回 / 中央値 2,022ms / 2 秒以内 49% (基準は 9 割) = pass false
 *    → ★ 外しても速さは買えていない
 * ```
 *
 * ## ★ 守ること
 *
 * ★★ **env が OFF のときは 1 文字も足さない** (organon / 辞書は opt-in。#304)。
 * ★★★ **ルームの決まり (light_prompt.md) を落とさない** —— 2026-09-05 に「一番欲しいもの」として
 *   戻した経緯があり、知識を足すときに消してはいけない。
 */
import { buildInstructions } from '../../src/routes/voiceChat.mts';

const ORGANON_BLOCK = '\n## 業務 DB 検索時の参考 (= organon polyseme + sql_mapping)\n仕切\n';
const VOCAB_BLOCK = '\n## 業務語彙の正規化 (= 別名 → 正規名)\n- 山崎 ← マサ\n';

const MEMORY_BLOCK = '## Memory\n- 朝礼の担当は週替わり\n';

const deps = (organon: string, vocab: string, memory = '') => ({
  organon: () => organon,
  vocab: () => vocab,
  memory: (_workspacePath: string) => memory,
});

describe('buildInstructions — 知識を載せる (#437)', () => {
  test('★ 基本の指示は常に入る', () => {
    const s = buildInstructions('朝礼', '/nowhere', deps('', ''));
    expect(s).toContain('朝礼');
    expect(s).toContain('get_messages');
  });

  test('★★★ organon を載せる', () => {
    const s = buildInstructions('朝礼', '/nowhere', deps(ORGANON_BLOCK, ''));
    expect(s).toContain('organon polyseme');
    expect(s).toContain('仕切');
  });

  test('★★★ 業務語彙を載せる (★ 人名の揺れはこちらに入っている)', () => {
    const s = buildInstructions('朝礼', '/nowhere', deps('', VOCAB_BLOCK));
    expect(s).toContain('業務語彙の正規化');
    expect(s).toContain('山崎 ← マサ');
  });

  test('★★★★ env が OFF なら 1 文字も足さない (opt-in を壊さない)', () => {
    const off = buildInstructions('朝礼', '/nowhere', deps('', ''));
    const on = buildInstructions('朝礼', '/nowhere', deps(ORGANON_BLOCK, VOCAB_BLOCK));
    expect(off).not.toContain('organon');
    expect(off).not.toContain('業務語彙');
    expect(on.length).toBeGreaterThan(off.length);
  });

  test('★★ 読み込みが落ちても会話は始まる (知識が薄くなるだけ)', () => {
    const boom = () => { throw new Error('読めません'); };
    const s = buildInstructions('朝礼', '/nowhere', { organon: boom, vocab: boom, memory: boom });
    expect(s).toContain('get_messages');
  });

  // ★ #439 最後のズレ (2026-09-27 利用者判断「今入れる」)。9/14 に「単に忘れていた。入れたほうがよい」。
  //   止めていたのは「#437 の速さを n>50 で測り直してから」という順番だけで、会話モードが 9/18 以降
  //   使われず、前後の生ログも 7 日の保持で消えた = 測り直しは成り立たなくなった。
  test('★★★★ ルームのメモリを載せる (Light と同じ loadMemoryForPrompt、ルームの作業場所から)', () => {
    const seen: string[] = [];
    const s = buildInstructions('朝礼', '/ws/agent/room1', {
      organon: () => '', vocab: () => '',
      memory: (p: string) => { seen.push(p); return MEMORY_BLOCK; },
    });
    expect(s).toContain('朝礼の担当は週替わり');
    expect(seen).toEqual(['/ws/agent/room1']);
  });

  test('メモリが空なら 1 文字も足さない', () => {
    const a = buildInstructions('朝礼', '/nowhere', deps('', '', ''));
    const b = buildInstructions('朝礼', '/nowhere', deps('', ''));
    expect(a).toBe(b);
  });

  test('★★★ 呼び方をフルネームへ言い換えない指示は残す (辞書を足しても変えない)', () => {
    const s = buildInstructions('朝礼', '/nowhere', deps(ORGANON_BLOCK, VOCAB_BLOCK));
    expect(s).toMatch(/フルネーム/);
  });
});
