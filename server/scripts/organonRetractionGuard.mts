/**
 * #384 撤去 (retraction) の歯止めと、語 (term) の撤去対象の判定。
 *
 * ## なぜ要るか
 *
 * `sync_organon_dict.mts` は upsert しか持たない。organon が語を deprecated にしても
 * **辞書テーブルの行は残り続ける**。残った語は補正段の prompt と STT の語彙に載り続け、
 * **実在する別の語に化けさせる**ことがある (2026-09-14、朝礼で実際に発生)。
 * 手で tombstone したのは 8/23・8/30・9/14 の 3 回。
 *
 * ★★★★★ 2026-09-20: 恒久策は **B (手動 + 検知)** で確定した (#384 は close)。
 *   ★ このファイルが持つ歯止めは **人が `organonDictPrune --apply` を叩くとき**に効く。
 *   ★★ 自動撤去 (sync への組み込み) は **採らないと決めた** —— 自動化で減るのは
 *     月 1 回叩く手間だけで、★★★ 歯止めに当たれば静かに止まるので **検知口はどちらでも要る**。
 *   ★★★★ 撤去待ちを数える口は `agent-server` の doctor (`organon-retraction`)。
 *     ★ 基準線の規則 (`staleCutoff`) は **この file のものを import して使っている**ので、
 *       ここを直すと doctor 側の判定も変わる (= 2 か所に書かない、が前提)。
 *   ★ 再開の条件: 撤去待ちが恒常的に残る / 人の介入が月 4 回を超える → 自動撤去へ寄せ直す。
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
 *   (c) 滞留    「今回の射影に無い」だけでは足りず、**STALE_PULLS 回ずっと不在**を要求する
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
/**
 * この回数ずっと射影に現れていない語だけを対象にする。
 * ★ 「日数」ではなく **pull の回数**。pull が止まっていた期間は不在の証拠にならない。
 */
export const DEFAULT_STALE_PULLS = 3;

export interface ActiveTermRow {
  term: string;
  source: string;
  updatedAt: Date;
}

/**
 * 「K 回前の pull」の時刻を返す。これが撤去の基準線になる。
 *
 * ★★★★ **日数で切ってはいけない。** 初版 (2026-09-14) は `now - 3日` で切っていたが、
 *   これは「3 回連続で不在」を保証しない:
 *
 *     ttl が 10 日 変わらない → pull が走らない → 全行の updated_at が 10 日古いまま
 *     11 日目に 1 語 deprecated → pull が走る → present な行だけ今に更新
 *     → 消えた語は「3 日以上 不在」に見えるが、★ 実際の不在は 1 回だけ
 *
 *   **pull が止まっていた期間は、不在の証拠にならない。** organon 班の
 *   「同じ指紋 (updated_at の停止) を逆の意味で読むので混ざらないように」(9/14) が当たった形。
 *
 * ★ 記録が K 回に満たなければ `null` = 撤去しない。**不在が続いたことを証明できないものは消さない。**
 *
 * @param runsDesc pull の実行時刻 (新しい順)
 */
export function staleCutoff(runsDesc: Date[], k: number = DEFAULT_STALE_PULLS): Date | null {
  if (runsDesc.length < k) return null;
  return runsDesc[k - 1];
}

/**
 * 撤去してよい語を選ぶ。
 *
 * ★ 絞りは **語自身の source**。manual / auto の語は射影に出てこないのが当たり前なので、
 *   出所で絞らないと必ず巻き添えになる (2026-08-27 に alias 側で実際にやった事故と同じ型)。
 * ★★ 「今回の射影に無い」だけでは足りない。`cutoff` (= K 回前の pull 時刻) より前で
 *   止まっていること、つまり **K 回続けて payload に入っていなかった**ことを要求する。
 */
export function selectStaleTerms(
  projectedTerms: string[],
  rows: ActiveTermRow[],
  cutoff: Date,
): ActiveTermRow[] {
  const keep = new Set(projectedTerms);
  return rows.filter(
    (r) => r.source === 'organon' && !keep.has(r.term) && r.updatedAt.getTime() < cutoff.getTime(),
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
