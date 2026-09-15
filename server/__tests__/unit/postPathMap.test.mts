/**
 * ★ `docs/07_投稿経路と付随処理.md` の地図が、実物とずれていないかを見張る (2026-09-15)。
 *
 * ## なぜ要るか
 *
 * ★ CLAUDE.md は「**『AI が起動しない』『通知が飛ばない』を調べる前にここを引くこと**
 *   (grep で組み立て直すと結論が毎回変わる)」と書いている。
 *   **つまりこの地図は、コードより先に信用される。**
 *
 * ★★★★ ところが 2026-09-15 に突き合わせたら、**22 日間 古いままだった**:
 * ```
 * 地図を書いた翌日 (2026-08-24) に #390 が構造を変えていた
 *   #12 の場所   routes/members.mts (private helper) → services/systemMessage.mts (共有化)
 *   ★★ 新しい経路 routes/bot.mts:1504 — bot が join したときの system メッセージ (地図に無かった)
 * ★ INSERT 文の総数は 18 のまま **変わっていない**
 * ```
 * ★★★ **件数が合っていることは、中身が合っていることの証拠にならない。**
 *   だから件数ではなく **ファイルごとの経路数**で見張る。
 *
 * ## ★★ 行番号では見張らない
 *
 * 行番号は無関係な編集のたびに動く。**毎回落ちる見張りは、そのうち黙らされる。**
 * → ★ 「どの file に 何経路あるか」で見る。★★ 経路の増減は捕まえられて、行のずれでは鳴らない。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DOC = path.resolve(ROOT, '../docs/07_投稿経路と付随処理.md');
const SRC = path.join(ROOT, 'src');

/** src 以下を歩いて `INSERT INTO messages` の在る file → 件数 を返す。 */
function countInsertsByFile(dir: string, acc = new Map<string, number>()): Map<string, number> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) countInsertsByFile(p, acc);
    else if (e.name.endsWith('.mts')) {
      const n = (fs.readFileSync(p, 'utf8').match(/INSERT INTO messages/g) || []).length;
      if (n) acc.set(e.name, (acc.get(e.name) || 0) + n);
    }
  }
  return acc;
}

/** 地図の表から `<file>.mts:<行>` を拾い、file ごとに数える。★ basename で見る (prefix の有無が揺れるため)。 */
function countRowsByFile(doc: string): Map<string, number> {
  const acc = new Map<string, number>();
  for (const m of doc.matchAll(/`[a-zA-Z/]*?([a-zA-Z]+\.mts):(\d+)`/g)) {
    acc.set(m[1], (acc.get(m[1]) || 0) + 1);
  }
  return acc;
}

describe('docs/07 投稿経路の地図 — ★ 黙って古くならない形にする', () => {
  const code = countInsertsByFile(SRC);
  const doc = countRowsByFile(fs.readFileSync(DOC, 'utf8'));

  it('★★★★ INSERT INTO messages を持つ file が、全部 地図に載っている', () => {
    const missing = [...code.keys()].filter((f) => !doc.has(f));
    // ★ 落ちたら「地図を直す」。**テストを緩めない** —— 緩めた瞬間に 22 日が再演する
    expect(missing).toEqual([]);
  });

  it('★★ file ごとの経路数が、地図の行数以下である', () => {
    // ★ 地図には「委譲」の行 (INSERT ではない呼び出し元) も載るので、地図の方が多いのは正常。
    //   ★★ **コードの方が多い = 新しい経路が地図に無い** —— これが #390 で起きた形。
    const over = [...code.entries()]
      .filter(([f, n]) => n > (doc.get(f) || 0))
      .map(([f, n]) => `${f}: コード ${n} 経路 / 地図 ${doc.get(f) || 0} 行`);
    expect(over).toEqual([]);
  });

  it('★ 地図が「INSERT 文の単位で数える」と宣言していること', () => {
    // ★★ 以前はファイル単位の表で、**それ自体が違いを潰していた** (地図の §1 に経緯あり)。
    //   数える単位が変わったら、この見張りの前提も変わる。
    expect(fs.readFileSync(DOC, 'utf8')).toContain('INSERT 文の単位で数える');
  });
});
