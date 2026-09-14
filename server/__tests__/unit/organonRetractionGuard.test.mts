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

  it('射影に無く、かつ最終更新が古い organon の語だけを対象にする', () => {
    const got = selectStaleTerms(['五月女'], rows, NOW, 3);
    expect(got.map((r) => r.term)).toEqual(['重久', '古澤']);
  });

  it('★ manual / auto の語は、射影に無くても対象にしない', () => {
    // 射影に出てこないのは当たり前 (organon 以外の出所)。出所で絞らないと巻き添えになる
    // —— 2026-08-27 に alias 側で実際にやった事故と同じ型。
    const got = selectStaleTerms([], rows, NOW, 3);
    expect(got.map((r) => r.term)).not.toContain('手で足した語');
  });

  it('★★ 直近に触られた語は、射影から一度消えただけでは対象にしない', () => {
    // ttl が 1 日だけ短くても、翌日に戻れば updated_at が進むので対象から外れる。
    // 「3 日以上ずっと不在」を条件にすることで、単発の欠けを弾く。
    const rows2: ActiveTermRow[] = [{ term: '昨日から不在', source: 'organon', updatedAt: old(1) }];
    expect(selectStaleTerms([], rows2, NOW, 3)).toEqual([]);
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
