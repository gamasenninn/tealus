/**
 * confirmMarks unit test — 〔要確認〕を「台帳に在るか」で 2 つに割る (2026-09-24)。
 *
 * ★ なぜ要るか: 朝礼/終礼の議事録に付く 〔要確認〕は 2 つの理由が混ざっている。
 *   ① 台帳に無い語        → ★ 人は「登録するか」を決める
 *   ② 台帳に在るが自信が無い → ★ 人は「聞き直す」しかない
 *   ★★ 混ざっているので、読む人は「どちらの理由で付いたか」が分からない。
 *
 * ★★★★★ **印を付けるのは「在る」側だけ。** 台帳に無いことは主張しない ——
 *   ★ 台帳 (dictionary.local.ttl) は **意図的に部分的**で、射影は Role/Organization しか運ばない
 *     (#331 Option 1)。★★ 地名 (Location) は canon に在っても台帳に無い。
 *   ★★★ 実測 (2026-09-24 / 朝礼+終礼 166 便・語に付いた印 529 箇所): 「台帳に無い」を
 *     [未登録] と主張すると、**316 箇所のうち 31 (9.8%) が canon には登録済み**だった
 *     (うち Location 24)。★★★★ **不在の主張は、台帳が部分的な分だけ嘘になる。**
 *   ★★★★★ 在ることの主張は、引いた台帳そのもので確かめられる = 空振りしない。
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../../src/lib/logger.mts';
import { splitConfirmMarks, buildLedgerLookup, loadLedgerSurfaces } from '../../src/lib/confirmMarks.mts';

/** 台帳の表層 (label + alias)。★ 敬称つきは射影が畳むので **入っていない**のが本番の姿 */
const LEDGER = new Set(['田部井', '五月女', '岡崎ウェスト', '壬生', 'JU愛知']);
const known = buildLedgerLookup(LEDGER);

describe('buildLedgerLookup', () => {
  it('台帳にそのまま在る語は在ると判定する', () => {
    expect(known('田部井')).toBe(true);
  });

  it('★ 末尾の敬称を 1 つ外した形でも当てる (射影が敬称つきを畳んでいるため)', () => {
    expect(known('田部井さん')).toBe(true);
    expect(known('五月女君')).toBe(true);
  });

  it('★ 前に余計なものが付いた形でも当てる (印の直前 12 文字で取るため)', () => {
    expect(known('第二展示場の岡崎ウェスト')).toBe(true);
  });

  it('台帳に無い語は無いと判定する', () => {
    expect(known('アグリカ')).toBe(false);
    expect(known('ポテカルゴ')).toBe(false);
  });

  it('★ 1 文字まで削り込まない (2 文字未満は見ない)', () => {
    // 「壬生」は在るが、1 文字の「生」で当ててはいけない
    expect(known('野生')).toBe(false);
  });
});

describe('splitConfirmMarks', () => {
  it('★★★★ 台帳に在る語の印にだけ 「登録済」を足す', () => {
    const r = splitConfirmMarks('- 田部井[要確認] に連絡', known);
    expect(r.text).toBe('- 田部井[要確認・登録済] に連絡');
    expect(r.annotated).toBe(1);
    expect(r.kept).toBe(0);
  });

  it('★★★★★ 台帳に無い語は 1 文字も変えない (★ 不在は主張しない)', () => {
    const src = '- アグリカ[要確認] の件';
    const r = splitConfirmMarks(src, known);
    expect(r.text).toBe(src);
    expect(r.kept).toBe(1);
    expect(r.annotated).toBe(0);
  });

  it('★ 括弧の種類 (全角/半角) はそのまま保つ', () => {
    expect(splitConfirmMarks('田部井〔要確認〕', known).text).toBe('田部井〔要確認・登録済〕');
    expect(splitConfirmMarks('田部井[要確認]', known).text).toBe('田部井[要確認・登録済]');
  });

  it('★★★★ 語が取れない印 (印そのものへの言及) は 1 文字も触らない', () => {
    const src = '確信度が低いものには **[要確認]** を付けてください';
    const r = splitConfirmMarks(src, known);
    expect(r.text).toBe(src);
    expect(r.kept).toBe(0);
    expect(r.annotated).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('印が 1 つも無い文章は 1 文字も変えない', () => {
    const src = '# 議事録\n- 売上: 4万2,000円\n';
    expect(splitConfirmMarks(src, known).text).toBe(src);
  });

  it('1 つの文章に両方あるとき、それぞれ別に判定する', () => {
    const r = splitConfirmMarks('田部井[要確認] と アグリカ[要確認]', known);
    expect(r.text).toBe('田部井[要確認・登録済] と アグリカ[要確認]');
    expect(r.annotated).toBe(1);
    expect(r.kept).toBe(1);
  });

  it('★ 敬称つきも台帳に素の形があれば 「登録済」が付く', () => {
    const r = splitConfirmMarks('- 田部井さん〔要確認〕 に確認', known);
    expect(r.text).toBe('- 田部井さん〔要確認・登録済〕 に確認');
    expect(r.annotated).toBe(1);
  });

  it('★★★★ 2 度かけても増えない (★ 既に 登録済 が付いた印は触らない)', () => {
    const once = splitConfirmMarks('田部井[要確認]', known).text;
    const twice = splitConfirmMarks(once, known);
    expect(twice.text).toBe(once);
    expect(twice.annotated).toBe(0);
  });
});

describe('loadLedgerSurfaces — ★★★★★ 空の台帳を「台帳」として返さない', () => {
  /**
   * ★ なぜ要るか: `loadVocabEntriesFromTtl` は **throw しない** (file が無くても
   *   parse に失敗しても 0 件を返す)。★★ だから try/catch だけでは
   *   **「file は在るが中身が無い」を掴めない**。
   * ★★★ 空集合を返すと「1 件も登録済が付かない」という **もっともらしい姿**になり、
   *   台帳が落ちたことに気づけない。★★★★ docstring はそう約束していたのに、
   *   2026-09-24 の実装は掴めていなかった (この test で捕まえた)。
   */
  const tmp = (name: string, body: string): string => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')), name);
    fs.writeFileSync(p, body, 'utf8');
    return p;
  };

  beforeEach(() => jest.clearAllMocks());

  it('★ file が無ければ null', () => {
    expect(loadLedgerSurfaces(path.join(os.tmpdir(), 'no-such-ledger-xyz.ttl'))).toBeNull();
  });

  it('★★★★ file は在るが 1 語も取れないときも null (★ 空集合を返さない)', () => {
    expect(loadLedgerSurfaces(tmp('empty.ttl', ''))).toBeNull();
  });

  it('★★ 中身が壊れていて 0 語のときも null', () => {
    expect(loadLedgerSurfaces(tmp('broken.ttl', 'これは Turtle ではありません\n{{{'))).toBeNull();
  });

  it('★★★ 0 語だったことを warn に出す (★ 黙って通さない)', () => {
    loadLedgerSurfaces(tmp('empty2.ttl', ''));
    const warned = (logger.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(warned).toMatch(/台帳/);
  });

  it('語が取れれば その集合を返す', () => {
    const ttl = [
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix org1: <https://tealus.local/organon/> .',
      '',
      '<https://tealus.local/dict/x>',
      '  rdfs:label "田部井" ;',
      '  org1:category "person" ;',
      '  org1:alias "タブイ" .',
      '',
    ].join('\n');
    const s = loadLedgerSurfaces(tmp('ok.ttl', ttl));
    expect(s).not.toBeNull();
    expect(s!.has('田部井')).toBe(true);
    expect(s!.has('タブイ')).toBe(true);
  });
});
