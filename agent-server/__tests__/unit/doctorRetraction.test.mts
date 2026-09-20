/**
 * #384 撤去待ちに気づく口 (2026-09-20)。
 *
 * ★ 何が空いているか: 撤去は **2 段**ある。
 * ```
 *   organon 射影 → DB          ★ ここが空いていた (撤去は organonDictPrune を人が叩く)
 *   DB → 在庫 (local.ttl)      ★★ ここは dict-overlay-drift が既に見ている
 * ```
 * ★★★ 手で tombstone したのは 8/23・8/30・9/14 の **3 回**。★ 申し送りは「4 回目 / 5 回目が来る」と
 *   書いている。**気づく口が無いので、気づくのは毎回 別件を調べていた途中**だった。
 *
 * ★★★★ **これは A (自動撤去) / B (手動 + 検知) のどちらを選んでも要る。**
 *   ★ A でも歯止め (上限 5 件 / 下振れ) に当たると **撤去は静かに止まる**ので、
 *     止まったまま残っていることを数える口が無いと同じ穴が開く。
 */
import { describe, it, expect } from '@jest/globals';
import { judgeRetractionBacklog } from '../../src/lib/doctor.mts';

const CUT = new Date('2026-09-18T03:00:00Z');

describe('judgeRetractionBacklog', () => {
  it('★ 撤去待ちが無ければ info', () => {
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: [], staleAliasCount: 0, cutoff: CUT, pullsRecorded: 12 });
    expect(f.level).toBe('info');
    expect(f.id).toBe('organon-retraction');
  });

  it('★★★★ 残っていれば warn。★ 語は名指しする', () => {
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: ['滝口', '重松'], staleAliasCount: 3, cutoff: CUT, pullsRecorded: 12 });
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('滝口');
    expect(f.detail).toContain('重松');
  });

  it('★★★ 別名は件数だけ出す (★ victim を名指ししない、という #384 の約束)', () => {
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: [], staleAliasCount: 4, cutoff: CUT, pullsRecorded: 12 });
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('4');
    expect(f.detail).toContain('別名');
  });

  it('★★ 基準線 (いつより前で止まっているか) を出す (★ 「古い」だけでは引き直せない)', () => {
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: ['滝口'], staleAliasCount: 0, cutoff: CUT, pullsRecorded: 12 });
    expect(f.detail).toContain('2026-09-18');
  });

  it('★★★★★ 上限を超えていたら、★ 叩いても止まることを先に言う (歯止め (b) に当たる)', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'];
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: many, staleAliasCount: 0, cutoff: CUT, pullsRecorded: 12 });
    expect(f.detail).toContain('上限');
    // ★ 「叩けば消える」と読ませない
    expect(f.fix).toContain('人');
  });

  it('★★★ pull の記録が足りなければ 判定しない (★ 不在が続いた証拠が無い)', () => {
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: null, staleAliasCount: null, cutoff: null, pullsRecorded: 2 });
    expect(f.level).toBe('info');
    expect(f.detail).toContain('2');
    // ★★ 「撤去待ちなし」と言わない (= 測れていないのだから)
    expect(f.detail).not.toContain('ありません');
  });

  it('★★★★ 引けなかったときは「0 件」と言わない (★ 壊れた値は沈黙より悪い)', () => {
    const f = judgeRetractionBacklog({ reachable: false, staleTerms: null, staleAliasCount: null, cutoff: CUT, pullsRecorded: 12 });
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('引けませんでした');
    expect(f.detail).not.toContain('0 件');
  });

  it('★ 多すぎるときは頭から出して残りは件数で言う', () => {
    const many = Array.from({ length: 9 }, (_, i) => `語${i}`);
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: many, staleAliasCount: 0, cutoff: CUT, pullsRecorded: 12 });
    expect(f.detail).toContain('語0');
    expect(f.detail).toContain('ほか');
  });

  it('★★ 次の手は dry-run から (★ いきなり --apply と言わない)', () => {
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: ['滝口'], staleAliasCount: 0, cutoff: CUT, pullsRecorded: 12 });
    expect(f.fix).toContain('organonDictPrune');
    expect(f.fix).toContain('dry-run');
  });
});

/**
 * ★★★★★ 2026-09-20 — **別名はこの口では数えない**。
 *
 * ★ 別名の撤去対象は `(term, alias) NOT IN unnest(射影)` で決まる (organonDictPrune)。
 *   ★★ updated_at では決まらないので、DB だけを引く doctor からは **正しく数えられない**。
 * ★★★ それらしい数を出すと、★ 「4 件残っている」と読んだ人が dry-run と突き合わせて
 *   合わないことに時間を使う。**数えていないと書く方が安い。**
 */
describe('judgeRetractionBacklog — ★ 別名を数えていないとき', () => {
  it('★★★★ 「数えていない」と書く (★ 0 件と言わない)', () => {
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: [], staleAliasCount: null, cutoff: CUT, pullsRecorded: 12 });
    expect(f.level).toBe('info');
    expect(f.detail).toContain('数えていません');
    expect(f.detail).not.toContain('別名 0 件');
  });

  it('★★ 語が残っているときも 併記する', () => {
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: ['滝口'], staleAliasCount: null, cutoff: CUT, pullsRecorded: 12 });
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('滝口');
    expect(f.detail).toContain('数えていません');
  });

  it('★ 語が 0 件 かつ 別名を数えていないなら、★★ 「撤去待ちなし」と断定しない', () => {
    const f = judgeRetractionBacklog({ reachable: true, staleTerms: [], staleAliasCount: null, cutoff: CUT, pullsRecorded: 12 });
    expect(f.detail).toContain('語はありません');
  });
});
