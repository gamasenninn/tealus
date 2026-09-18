/**
 * #384 organon の pull 状態を「引ける口」として置く。
 *
 * ## なぜ通知だけでは足りないか
 *
 * 停止時だけ 1 行 出す形にすると、**沈黙が 2 つの意味を持つ**:
 *
 *   (1) pull は動いていて異常が無い
 *   (2) ★ 通知の仕組み自体が止まっている
 *
 * organon 班は `listen-tealus` skill で一度これに焼かれている。日次 1 行を足しても
 * 「来るはずのものが来ない」と誰かが気づいて初めて機能するので、見る人がいなければ同じ。
 *
 * ★ なので通知ではなく **口**を置く。向こうは毎日 Step 5 を回すので、そこで 1 回引けばよい。
 *   通知と口の両方が落ちて初めて見えなくなる。
 *
 * ★★ 「送る側が通知してくれること」を前提にした監視は監視でない ——
 *   「歯止めは受け取る側に置く」の、監視への素直な適用 (2026-09-14 の両班の合意)。
 *
 * ## 置き場所
 *
 * ★ **どちらの repo でもない場所** (既定 `~/.tealus/organon-pull-state.json`)。
 *   organon の作業ツリーに書くと誤って commit されうるし、tealus の中だと向こうから
 *   見つけにくい。organon 班は同じマシンで動いているので、file で足りる
 *   (API にすると認証が要り、外に口を開けることになる)。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.mts';

export interface PullState {
  last_pull_at: string;
  terms: number;
  aliases: number;
  /**
   * ★ pull 直後の「DB に居る organon 由来の active な語」の数 (2026-09-15)。
   * ★★ null = 引けなかった。**0 と書かない** (引く側が「1 件も無い」と読む)。
   */
  db_organon_active_terms: number | null;
  /**
   * ★ `db_organon_active_terms - terms`。**pull 直後なら 0 のはず。**
   *
   * ★★ なぜ生の数字ではなく差を置くか: organon 班は DB を引けないので、
   *   「DB の active 数」を 1 つ足しても **比べる相手がいない**。差にして初めて
   *   **1 file だけで読める不変条件**になる。
   * ★★★ 正 = 射影から外れた語が DB に残っている (撤去が届いていない)。
   *   負 = 射影にある語が DB に無い (sync が途中で落ちた等)。
   * ★★★★ 実績: 2026-09-15 の撤去前は 射影 257 / DB 259 = drift 2 だった。
   *   **この欄があれば #384 の積み残しは毎日見えていた。**
   */
  drift: number | null;
  /**
   * ★ organon 由来で active な **別名** の数 (2026-09-18、organon 班の依頼)。
   * ★★ null = 引けなかった。0 と書かない。
   */
  db_organon_active_aliases: number | null;
  /**
   * ★ **語の drift と式が違う。** `db_organon_active_aliases - aliases` **ではない。**
   *
   * ★★ 理由: `upsertAlias` は source を上書きしない (= 意図的な約束) ので、`source` は
   *   「今どこから来ているか」ではなく **「誰が最初に入れたか」**を記録している。
   *   射影に載っている別名でも、先に自己成長辞書が入れた行は source='auto' のまま残る。
   *   ★★★ 実測 (2026-09-18): 射影 614 / organon 由来 active 607。差 -7 は
   *   **tombstone 1 + 先に別の出所が入った 6** で、どれも正常。引き算を drift と呼ぶと
   *   **毎日 -7 が出て「sync が落ちた」と読まれる**。
   *
   * ★★★★ なので **「射影から外れたのに DB に残っている organon 由来の active 別名」**
   *   = 撤去の積み残し、だけを drift_aliases とする。**正常は 0**、正 = 撤去が届いていない。
   */
  drift_aliases: number | null;
  /**
   * ★ 射影には載っているが、organon 由来の active 行になっていない組の数。
   * ★★ **異常ではない** (tombstone / 先に別の出所が入った行)。
   *   ★★★ この欄が無いと、引く側が `aliases - db_organon_active_aliases` を自分で計算して
   *   「届いていない」と読む。**読み違えを防ぐためだけに置いている。**
   */
  aliases_held_by_other_source: number | null;
  ttl_path: string;
  note: string;
}

export function pullStatePath(): string {
  return (
    process.env.ORGANON_PULL_STATE_PATH ||
    path.join(os.homedir(), '.tealus', 'organon-pull-state.json')
  );
}

/**
 * 書き出す中身を組み立てる。★ 純関数。
 *
 * ★ `ok` / `success` のような欄は置かない。**成功したときだけ書く**のは呼び出し側の約束で、
 *   ここに真偽の欄を置くと「false もありうる」と読まれ、引く側が要らない分岐を書く。
 */
export function buildPullState({
  ranAt,
  terms,
  aliases,
  ttlPath,
  dbOrganonActiveTerms,
  dbOrganonActiveAliases,
  aliasesNotInProjection,
  aliasesHeldByOtherSource,
}: {
  ranAt: Date;
  terms: number;
  aliases: number;
  ttlPath: string;
  /** ★ 省略 / undefined = 引けなかった。★★ 0 を渡すのは「本当に 0 件」のときだけ。 */
  dbOrganonActiveTerms?: number | null;
  /** ★ organon 由来で active な別名の総数。★★ 省略 = 引けなかった。 */
  dbOrganonActiveAliases?: number | null;
  /** ★ そのうち射影に無いもの = 撤去の積み残し。★★ これが `drift_aliases` になる。 */
  aliasesNotInProjection?: number | null;
  /** ★ 射影にあるが organon 由来の active 行になっていない組の数 (tombstone / 別の出所)。 */
  aliasesHeldByOtherSource?: number | null;
}): PullState {
  const dbActive = dbOrganonActiveTerms ?? null;
  return {
    last_pull_at: ranAt.toISOString(),
    terms,
    aliases,
    db_organon_active_terms: dbActive,
    drift: dbActive === null ? null : dbActive - terms,
    db_organon_active_aliases: dbOrganonActiveAliases ?? null,
    drift_aliases: aliasesNotInProjection ?? null,
    aliases_held_by_other_source: aliasesHeldByOtherSource ?? null,
    ttl_path: ttlPath,
    // ★ file 自身に意味を書く。後から開く人が「最後に成功した pull」なのか
    //   「最後に試した pull」なのかを判断できないと、止まっているか動いているかを読み違える。
    note:
      'tealus が最後に成功した pull。失敗した回では更新されない (= この時刻より後に成功していない)。'
      + ' drift = db_organon_active_terms - terms で、pull 直後なら 0。'
      + ' 正 = 射影から外れた語が DB に残っている (撤去が届いていない)。'
      + ' null = DB を引けなかった (0 件ではない)。'
      // ★ 別名は式が違う。★★ ここに書いておかないと、引く側が語と同じ引き算をして読み違える
      + ' drift_aliases は語とは式が違う: db_organon_active_aliases - aliases ではなく,'
      + ' 「射影から外れたのに DB に残っている organon 由来の active 別名」の数 (= 撤去の積み残し、正常は 0)。'
      + ' aliases_held_by_other_source は射影にあるが organon 由来の active 行でない組の数で,'
      + ' tombstone や「先に別の出所が入った行」= 正常 (source は今の供給元ではなく最初に入れた側を記録する)',
  };
}

/**
 * 状態を書き出す。★ best-effort —— 失敗しても pull 本体は落とさない。
 *
 * ★★ ただし黙らない。書けないまま放置すると、引く側からは「pull が止まった」に見える
 *   (= 本当は書き込みだけが失敗している)。ログには必ず残す。
 */
export function writePullState(state: PullState): boolean {
  try {
    const p = pullStatePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf8');
    return true;
  } catch (err) {
    logger.warn(
      `[organon-dock] pull 状態の書き出しに失敗 (pull は成功しています): ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
