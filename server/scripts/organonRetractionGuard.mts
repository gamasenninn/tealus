/**
 * #384 撤去 (retraction) の歯止めと、語 (term) の撤去対象の判定。
 *
 * ## なぜ要るか
 *
 * `sync_organon_dict.mts` は upsert しか持たない。organon が語を deprecated にしても
 * **辞書テーブルの行は残り続ける**。残った語は補正段の prompt と STT の語彙に載り続け、
 * **実在する別の語に化けさせる**ことがある (2026-09-14、朝礼で実際に発生)。
 * 手で tombstone したのは 8/23・8/30・9/14 の 3 回。恒久策が要る。
 *
 * ## ★ 歯止めが要る理由 (organon 班の指摘、2026-09-14)
 *
 * organon の `organon_to_rdf.py` は **ttl を書いてから健診で落ちる**。parse に失敗した
 * entry はグラフに入らないまま書き出されるので、**ファイルは空にならず「短くなる」**:
 *
 *     Day 52 (2026-07-09)  193 件中 121 件しか parse できず、ttl に 72 件が無い
 *
 * → その日に撤去が走っていたら **72 件が一括で消えていた**。
 * ★ 「payload が空なら何もしない」では止まらない (121 件 入っているので空ではない)。
 *
 * ## 歯止めは 3 枚 (★ すべて状態を持たない)
 *
 *   (a) 下振れ  射影が DB の現勢より RATIO 以上 少なければ 撤去しない
 *               ★ 比較対象は DB 自身なので、前回値を保存しなくてよい
 *   (b) 上限    1 回に落とせる件数の上限。超えたら **実行せず** 人へ回す
 *   (c) 滞留    「今回の射影に無い」だけでは足りず、**STALE_DAYS 以上ずっと不在**を要求する
 *               ★ upsertTerm が present な行に必ず updated_at = NOW() を打つので、
 *                 「触られていない期間」がそのまま「不在の期間」になる。
 *                 organon 班が 8/30 に見つけた「updated_at が片方だけ止まる」が指紋。
 *
 * ★★ 歯止めは **受け取る側**に置く。上流 (organon 側) が健診を厳しくしても、
 *   ttl が短くなる経路は他にありうる (手編集 / git の事故)。
 *   「渡す側が正しいこと」を前提にした歯止めは歯止めでない。
 *
 * ## ★★★ 撤去は削除ではなく tombstone
 *
 * 語は `status='rejected'` にする。`upsertTerm` の guard が rejected を尊重するので
 * 次の取り込みで復活しない (#375)。削除だと (1) なぜ消したかが残らない
 * (2) guard と対にならず復活する。
 */

/** 撤去を許すかどうかの既定値。★ 事後に緩めない (緩める側にしか動かないため)。 */
export const DEFAULT_MAX_VICTIMS = 5;
/** 射影が DB の現勢のこの割合を下回ったら撤去しない。 */
export const DEFAULT_MIN_RATIO = 0.8;
/** この日数ずっと射影に現れていない語だけを対象にする。 */
export const DEFAULT_STALE_DAYS = 3;

export interface ActiveTermRow {
  term: string;
  source: string;
  updatedAt: Date;
}

/**
 * 撤去してよい語を選ぶ。
 *
 * ★ 絞りは **語自身の source**。manual / auto の語は射影に出てこないのが当たり前なので、
 *   出所で絞らないと必ず巻き添えになる (2026-08-27 に alias 側で実際にやった事故と同じ型)。
 * ★★ 「今回の射影に無い」だけでは足りない。ttl が 1 日だけ短くても落ちないように、
 *   staleDays 以上 触られていないことを要求する。
 */
export function selectStaleTerms(
  projectedTerms: string[],
  rows: ActiveTermRow[],
  now: Date,
  staleDays: number = DEFAULT_STALE_DAYS,
): ActiveTermRow[] {
  const keep = new Set(projectedTerms);
  const cutoff = now.getTime() - staleDays * 24 * 60 * 60 * 1000;
  return rows.filter(
    (r) => r.source === 'organon' && !keep.has(r.term) && r.updatedAt.getTime() < cutoff,
  );
}

export interface RetractionInput {
  /** 今回の射影に含まれる語数 */
  projectedCount: number;
  /** DB 側で現に active な organon 由来の語数 */
  dbActiveCount: number;
  /** 撤去候補の件数 */
  victimCount: number;
  maxVictims?: number;
  minRatio?: number;
}

export interface RetractionPlan {
  /** apply = 実行してよい / skip = 歯止めに当たった / noop = 対象が無い */
  action: 'apply' | 'skip' | 'noop';
  reason: string;
}

/**
 * 撤去を実行してよいかを決める。★ 純関数 (DB も時計も触らない)。
 *
 * ★ `noop` を `skip` と分ける理由: 0 件を「止まった」と同じ扱いにすると、平常運転が
 *   毎回「止まりました」を出し続け、**本当に止まった日が沈む**。
 */
export function planRetraction({
  projectedCount,
  dbActiveCount,
  victimCount,
  maxVictims = DEFAULT_MAX_VICTIMS,
  minRatio = DEFAULT_MIN_RATIO,
}: RetractionInput): RetractionPlan {
  if (projectedCount <= 0) {
    return { action: 'skip', reason: '射影が空 — ttl を読めていない可能性があるため撤去しない' };
  }
  if (dbActiveCount > 0 && projectedCount < dbActiveCount * minRatio) {
    const pct = Math.round((projectedCount / dbActiveCount) * 100);
    return {
      action: 'skip',
      reason:
        `射影の下振れ (${projectedCount} / DB ${dbActiveCount} = ${pct}%) — ` +
        `ttl が途中で切れている疑い。撤去しない`,
    };
  }
  if (victimCount === 0) {
    return { action: 'noop', reason: '撤去対象なし' };
  }
  if (victimCount > maxVictims) {
    return {
      action: 'skip',
      reason: `1 回の上限 ${maxVictims} 件を超えた (${victimCount} 件) — 人が見るまで撤去しない`,
    };
  }
  return { action: 'apply', reason: `${victimCount} 件を撤去してよい` };
}
