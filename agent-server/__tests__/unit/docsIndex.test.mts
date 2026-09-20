/**
 * #447 系 — **索引が本文に追いつかない**ことに気づく口 (2026-09-20)。
 *
 * ★ 2026-09-19: report/ 128 本に一覧が無いことに丸一日かけ、★★ 同じ型が CLAUDE.md にもあった。
 *   ★★★ `docs/` 直下 19 本のうち **9 本しか CLAUDE.md に出てこなかった** (実測)。
 *   → ★ 申し送りは「設計書は 8 本」と読み、**存在する 10 本を見ないまま**次の日を始めていた。
 *
 * ★★★★ 索引を直すだけでは また腐る。★ **落ちたら数える口**を置く。
 */
import { describe, it, expect } from '@jest/globals';
import { judgeDocsIndex } from '../../src/lib/docsIndex.mts';

describe('judgeDocsIndex', () => {
  it('★ 全部載っていれば info。★★ 「不足」と言わない', () => {
    const f = judgeDocsIndex(['01_要件定義.md', '02_DB設計.md'], '- `docs/01_要件定義.md`\n- `docs/02_DB設計.md`');
    expect(f.level).toBe('info');
    expect(f.detail).toContain('2');
    expect(f.detail).not.toContain('落ちて');
  });

  it('★★★★ 落ちている本があれば warn。★ 名指しする (★★ 件数だけ出すと探し直しになる)', () => {
    const f = judgeDocsIndex(['01_要件定義.md', '04_思想.md'], '- `docs/01_要件定義.md`');
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('04_思想.md');
    expect(f.detail).not.toContain('01_要件定義.md');
  });

  it('★★★★★ 部分一致で誤魔化さない (★ `ls | grep` が substring で誤答する型)', () => {
    // ★ `docs/upgrade-guide.md` は `guide.md` を含むが、**別の doc である**
    const f = judgeDocsIndex(['guide.md', 'upgrade-guide.md'], '- `docs/upgrade-guide.md`');
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('guide.md');
  });

  it('★★★ 読めなかったときは「全部載っている」と言わない (★ 壊れた値は沈黙より悪い)', () => {
    const f = judgeDocsIndex(null, '- `docs/01_要件定義.md`');
    expect(f.level).toBe('info');
    expect(f.detail).not.toContain('すべて');
  });

  it('★★ doc が 0 件なら 器を先に疑う (★ warn にしない)', () => {
    // ★ 「0 件なら 全部載っている」は形式的には真だが、★★ 実際は パスを外している
    const f = judgeDocsIndex([], 'CLAUDE.md の本文');
    expect(f.level).toBe('info');
    expect(f.detail).toContain('0 件');
  });

  it('★ CLAUDE.md が空でも落ちない (★★ 全部 落ちていると数える)', () => {
    const f = judgeDocsIndex(['a.md', 'b.md'], '');
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('a.md');
    expect(f.detail).toContain('b.md');
  });

  it('★ id は docs-index (★★ CLAUDE.md がこの名前で約束している)', () => {
    expect(judgeDocsIndex(['a.md'], '`docs/a.md`').id).toBe('docs-index');
  });

  it('★★ 多すぎるときは頭から出して、残りは件数で言う (★ 1 行に 20 本並べない)', () => {
    const many = Array.from({ length: 12 }, (_, i) => `m${i}.md`);
    const f = judgeDocsIndex(many, '');
    expect(f.detail).toContain('m0.md');
    expect(f.detail).toContain('ほか');
    expect(f.detail).toContain('12');
  });
});
