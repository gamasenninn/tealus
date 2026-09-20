/**
 * 索引が本文に追いつかないことに気づく口 (#447 系、2026-09-20)。
 *
 * ★ なぜ要るか: `docs/` 直下 19 本のうち **9 本しか CLAUDE.md に出てこなかった** (2026-09-20 実測)。
 *   ★★ 落ちていた 10 本には `00_what-is-tealus.md` と `04_オーガニックオントロジー構造.md` が
 *     含まれる。★★★ 前日の申し送りは索引だけを見て「設計書は 8 本」と書いていた。
 *
 * ★★★★ **同じ型を 3 回見ている**:
 *   1. #447  report/ に一覧が無い (一覧を作って測って、最後は grep に畳んだ)
 *   2. #445  受け入れ条件のチェックが 2 日前に終わった仕事のまま空だった
 *   3. ここ  doc を足して CLAUDE.md に足し忘れる
 *   → ★ **索引を直すだけでは また腐る。落ちたら数える口を置く。**
 *
 * ★★★★★ 約束 (doctor の他の口と同じ):
 *   - **自動で直さない。** 引ける口に出すだけ (★ 何を足すかは書く人が決める)
 *   - **読めなかったら「全部載っている」と言わない** (★★ 壊れた値は沈黙より悪い)
 *   - **0 件なら器を先に疑う** (★ 0 件は形式的には「全部載っている」だが、実際はパスを外している)
 */
import type { Finding } from './doctor.mts';

/** ★ 1 行に並べる上限。★★ これを超えたら「ほか N 本」に畳む */
const SHOW_MAX = 5;

/**
 * `docs/` 直下の doc が CLAUDE.md から参照されているかを判じる。★ 純関数。
 *
 * @param files doc の **ファイル名** (basename)。★ null = 読めなかった (空配列と区別する)
 * @param claudeMd CLAUDE.md の本文
 *
 * ★★★★ 照合は **`docs/` を付けた形**で行う。★ basename だけで `includes` すると
 *   `upgrade-guide.md` が `guide.md` を含んでしまい、★★ **別の doc を「載っている」と数える**
 *   (= `ls | grep` が substring で誤答するのと同じ型)。
 */
export function judgeDocsIndex(files: string[] | null, claudeMd: string): Finding {
  if (files === null) {
    return {
      id: 'docs-index',
      level: 'info',
      detail: '★ docs/ を読めませんでした (★★ パスが違う / 権限)',
      fix: '★ ここでは判定しません。★★ 読めないことと「全部載っていること」は別です',
    };
  }
  if (files.length === 0) {
    return {
      id: 'docs-index',
      level: 'info',
      // ★ 「0 件だから欠けは 0 件」と書くと、**パスを外していることが成功に見える**
      detail: '★ docs/ 直下の .md が 0 件でした (★★ 数える対象が無い = 先に器を疑うこと)',
      fix: '★ doctor を動かした場所と docs/ の位置を確かめる',
    };
  }

  const missing = files.filter((name) => !claudeMd.includes(`docs/${name}`));

  if (missing.length === 0) {
    return {
      id: 'docs-index',
      level: 'info',
      detail: `★ docs/ 直下の ${files.length} 本すべてが CLAUDE.md に出てきます`,
      fix: '★ doc を足したら CLAUDE.md の「設計書」にも 1 行足すこと',
    };
  }

  // ★ 名指しする (★★ 件数だけ出すと、読んだ人が探し直すことになる)
  const head = missing.slice(0, SHOW_MAX).join(' / ');
  const tail = missing.length > SHOW_MAX ? ` ほか ${missing.length - SHOW_MAX} 本` : '';
  return {
    id: 'docs-index',
    level: 'warn',
    detail: `★ CLAUDE.md から参照されていない doc が ${missing.length} 本 落ちています: ${head}${tail} (★★ 全 ${files.length} 本)`,
    fix: '★ CLAUDE.md の「設計書」に 1 行ずつ足す。★★ 開かなくてよい doc なら **そう書いて**載せる (★★★ 載せないと「無い」と読まれる)',
  };
}

/**
 * 実物を読んで判じる。★ 判断は上の純関数に置き、ここは **読む役だけ**。
 *
 * ★★ 場所は **この module からの相対**で決める (`agent-server/src/lib` → repo root)。
 *   ★★★ cwd 依存にすると、`npm run doctor` を どこから叩いたかで結果が変わる。
 */
export async function checkDocsIndex(): Promise<Finding> {
  const { readFile, readdir } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');

  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  let files: string[] | null = null;
  let claudeMd = '';
  try {
    const entries = await readdir(join(root, 'docs'), { withFileTypes: true });
    // ★ 直下の .md だけ (★★ presentation/ 等の下位は索引しないと CLAUDE.md で宣言している)
    files = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
  } catch {
    files = null; // ★ 「読めなかった」。★★ 0 件と混ぜない
  }
  try {
    claudeMd = await readFile(join(root, 'CLAUDE.md'), 'utf8');
  } catch {
    // ★ CLAUDE.md を読めなければ照合できない。★★ 「全部落ちている」と誤報しないため null に倒す
    files = null;
  }
  return judgeDocsIndex(files, claudeMd);
}
