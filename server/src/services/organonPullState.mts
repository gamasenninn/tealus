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
}: {
  ranAt: Date;
  terms: number;
  aliases: number;
  ttlPath: string;
}): PullState {
  return {
    last_pull_at: ranAt.toISOString(),
    terms,
    aliases,
    ttl_path: ttlPath,
    // ★ file 自身に意味を書く。後から開く人が「最後に成功した pull」なのか
    //   「最後に試した pull」なのかを判断できないと、止まっているか動いているかを読み違える。
    note: 'tealus が最後に成功した pull。失敗した回では更新されない (= この時刻より後に成功していない)',
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
