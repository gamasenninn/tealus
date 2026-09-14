/**
 * #439 Step 4 — 配線の取り残しを 2 つの網で捕まえる。
 *
 * ★ 表 (promptKnowledge) だけでは足りない理由
 *   表は「**部品**を足したとき」の取り残しを型で殺す。だが **経路**を足したときは、
 *   その経路が中央を呼ばなければ何も起きない。#437 (会話モードだけ知識を受け取って
 *   いなかった) が、まさにその形だった。
 *
 * ★★ そこで 2 つ凍結する:
 *   ① loader を直接 import してよい file      … 手配線の復活を捕まえる
 *   ② agent を起動する入口 (process* / realtime) … 「何も読まない新経路」を捕まえる
 *
 * ★★★ どちらも **落ちたら直す**のではなく、**落ちたら考える**テスト。
 *   増やしてよい。ただし「増やすときに表を見た」ことを、リストの更新で示す。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.mts')) out.push(p);
  }
  return out;
}

/** src からの相対パスを posix 表記で返す (Windows でも比較を安定させる)。 */
function rel(p: string): string {
  return path.relative(SRC, p).split(path.sep).join('/');
}

function filesMatching(re: RegExp): string[] {
  return walk(SRC)
    .filter((p) => re.test(fs.readFileSync(p, 'utf8')))
    .map(rel)
    .sort();
}

describe('#439 Step 4 ① — 知識 loader を直接 import してよい file', () => {
  /**
   * ★ ここに無い file が loader を import したら、**中央を迂回した手配線**が復活したということ。
   *   その file を表 (promptKnowledge) の経路として登録してから、このリストに足すこと。
   */
  const ALLOWED = [
    'agents/light.mts', // 経路 lightV1 (★ partsFor 経由で使う)
    'agents/lightV2.mts', // 経路 lightV2
    'lib/organonContext.mts', // loader 本体
    'lib/vocabContext.mts', // loader 本体
    'memory/fileMemory.mts', // loader 本体
    'routes/voiceChat.mts', // 経路 conversation
    'webhook/dispatcher.mts', // 経路 deep / delegate* / synthesize
  ];

  it('凍結したリストと一致する', () => {
    expect(filesMatching(/load(OrganonPolysemeForPrompt|VocabForPrompt|MemoryForPrompt)/)).toEqual(
      ALLOWED,
    );
  });

  it('★ loader を使う経路 file は、必ず partsFor も呼んでいる', () => {
    // ★ import しているのに表を見ていない = 手配線がそのまま残っている、を捕まえる。
    const loaderOwners = ['lib/organonContext.mts', 'lib/vocabContext.mts', 'memory/fileMemory.mts'];
    for (const f of ALLOWED) {
      if (loaderOwners.includes(f)) continue;
      const text = fs.readFileSync(path.join(SRC, f), 'utf8');
      expect({ file: f, usesTable: text.includes('partsFor') }).toEqual({ file: f, usesTable: true });
    }
  });
});

describe('#439 Step 4 ② — agent を起動する入口', () => {
  /**
   * ★★ 「知識を何も読まない新経路」は ① では捕まらない (loader を import しないので)。
   *   入口そのものを凍結して、**増えたら表を見させる**。
   *
   * ★ lightCustomExample は `AGENT_LIGHT_BACKEND` に渡す自作 backend の見本。
   *   契約が「processLight を export」だけで知識配線を含まないため、
   *   **自作 backend は全部 × になり得る**という #439 の指摘がそのまま当てはまる。
   *   見本なので現状は許すが、リストに残して見えるようにしておく。
   */
  const ENTRIES = [
    'agents/deep.mts',
    'agents/deepCodex.mts',
    'agents/light.mts',
    'agents/lightCustomExample.mts', // ★ 自作 backend の見本 (知識配線は契約外)
    'agents/lightV2.mts',
  ];

  it('process* の入口が凍結したリストと一致する', () => {
    expect(filesMatching(/export (async )?function process[A-Z]/)).toEqual(ENTRIES);
  });

  it('★ Realtime セッションを張る file は 1 つだけ', () => {
    // 会話モードが増えたらここが落ちる。#437 の型 (新しい入口が知識を受け取らない) の入口。
    expect(filesMatching(/v1\/realtime/)).toEqual(['routes/voiceChat.mts']);
  });
});
