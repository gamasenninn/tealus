/**
 * #384 撤去の歯止め + 語 (term) の撤去対象の判定 unit test。
 *
 * ★ なぜ歯止めが要るか (organon 班の指摘、2026-09-14)
 *   organon の `organon_to_rdf.py` は **ttl を書いてから健診で落ちる**。
 *   parse に失敗した entry はグラフに入らないまま ttl が書き出されるので、
 *   **ファイルは空にならず「短くなる」**。
 *     Day 52 (2026-07-09): 193 件中 121 件しか parse できず、ttl に 72 件が無い
 *   → その日に撤去が走っていたら **72 件が一括で消えていた**。
 *   ★ 「payload が空なら何もしない」では止まらない (121 件 入っているので空ではない)。
 *
 * ★★ 既存の `organonDictPrune.mts` (#381、alias 用) は **歯止めを持っていない**。
 *   `--apply` を短い ttl で叩けば同じ事故になる。この判定を通す形にする。
 *
 * ★★★ 撤去は「消す」ではなく **tombstone (status='rejected')**。
 *   `upsertTerm` の guard が rejected を尊重するので、次の取り込みで復活しない (#375)。
 */
import {
  planRetraction,
  selectStaleTerms,
  staleCutoff,
  type ActiveTermRow,
} from '../../scripts/organonRetractionGuard.mts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-14T06:00:00Z');
const old = (days: number): Date => new Date(NOW.getTime() - days * DAY);

describe('selectStaleTerms', () => {
  const rows: ActiveTermRow[] = [
    { term: '重久', source: 'organon', updatedAt: old(55) },
    { term: '古澤', source: 'organon', updatedAt: old(34) },
    { term: '五月女', source: 'organon', updatedAt: old(0) }, // 今回の pull で触られた
    { term: '手で足した語', source: 'manual', updatedAt: old(90) },
  ];
  // ★ 基準は「K 回前の pull の時刻」。日数ではない (下の回帰テスト参照)。
  const cutoff = old(3);

  it('射影に無く、かつ K 回前の pull より前で止まっている organon の語だけを対象にする', () => {
    const got = selectStaleTerms(['五月女'], rows, cutoff);
    expect(got.map((r) => r.term)).toEqual(['重久', '古澤']);
  });

  it('★ manual / auto の語は、射影に無くても対象にしない', () => {
    // 射影に出てこないのは当たり前 (organon 以外の出所)。出所で絞らないと巻き添えになる
    // —— 2026-08-27 に alias 側で実際にやった事故と同じ型。
    expect(selectStaleTerms([], rows, cutoff).map((r) => r.term)).not.toContain('手で足した語');
  });

  it('★★ 直近の pull で触られた語は、射影から一度消えただけでは対象にしない', () => {
    const rows2: ActiveTermRow[] = [{ term: '昨日から不在', source: 'organon', updatedAt: old(1) }];
    expect(selectStaleTerms([], rows2, cutoff)).toEqual([]);
  });
});

describe('staleCutoff — ★ 「日数」ではなく「pull 回数」で切る', () => {
  /**
   * ★ 回帰テスト。2026-09-14 の初版は `now - 3日` で切っていた。これだと:
   *
   *   ttl が 10 日 変わらない → pull が走らない → 全行の updated_at が 10 日古いまま
   *   11 日目に 1 語 deprecated → pull が走る → present な行だけ今に更新
   *   → 消えた語は「3 日以上 不在」に見えるが、★ 実際の不在は 1 回だけ
   *
   * 「3 回連続で不在」の保険が効かず、1 回の不在で落ちる。
   * organon 班の「同じ指紋を逆の意味で読むので混ざらないように」(9/14) が当たった形。
   */
  it('K 回前の pull 時刻を返す', () => {
    const runs = [old(0), old(1), old(2), old(9), old(30)]; // 新しい順
    expect(staleCutoff(runs, 3)).toEqual(old(2));
  });

  it('★ pull の記録が K 回に満たなければ null (= 撤去しない)', () => {
    // 不在が続いたことを **証明できない**。証明できないものを消さない。
    expect(staleCutoff([old(0), old(1)], 3)).toBeNull();
    expect(staleCutoff([], 3)).toBeNull();
  });

  it('★★ 日数では代用できない — pull が止まっていた期間は不在の証拠にならない', () => {
    // 10 日 pull が無く、直前の 1 回だけ走った状況。日数基準なら誤って撤去してしまう。
    const runs = [old(0), old(10), old(11)];
    const cutoff = staleCutoff(runs, 3);
    const victim: ActiveTermRow[] = [{ term: '昨日消えた語', source: 'organon', updatedAt: old(10) }];
    // cutoff = 11 日前。updated_at (10 日前) はそれより新しいので対象外 = 落ちない。
    expect(cutoff).toEqual(old(11));
    expect(selectStaleTerms([], victim, cutoff!)).toEqual([]);
  });
});

describe('planRetraction', () => {
  const base = { projectedCount: 257, dbActiveCount: 259, victimCount: 2 };

  it('平常時は実行する', () => {
    const p = planRetraction(base);
    expect(p.action).toBe('apply');
  });

  it('★ 射影が大きく下振れしたら実行しない (Day 52 型)', () => {
    // 193 件あったところへ 121 件しか来なかった日。空ではないので件数では弾けない。
    const p = planRetraction({ projectedCount: 121, dbActiveCount: 193, victimCount: 72 });
    expect(p.action).toBe('skip');
    expect(p.reason).toContain('下振れ');
  });

  it('★★ 1 回で落とす件数に上限を置く', () => {
    const p = planRetraction({ projectedCount: 257, dbActiveCount: 259, victimCount: 6 });
    expect(p.action).toBe('skip');
    expect(p.reason).toContain('上限');
  });

  it('★★★ 対象が 0 件なら何もしない (skip ではなく noop)', () => {
    // 0 件を skip と同じ扱いにすると、平常運転が「止まった」ログを出し続けて
    // 本当に止まった日を隠す。
    const p = planRetraction({ ...base, victimCount: 0 });
    expect(p.action).toBe('noop');
  });

  it('★★★★ 射影が空なら実行しない (下振れ判定より先に効く)', () => {
    const p = planRetraction({ projectedCount: 0, dbActiveCount: 259, victimCount: 259 });
    expect(p.action).toBe('skip');
  });

  it('DB 側が 0 件の初回でも落ちない', () => {
    const p = planRetraction({ projectedCount: 257, dbActiveCount: 0, victimCount: 0 });
    expect(p.action).toBe('noop');
  });
});
