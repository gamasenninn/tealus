/**
 * #331 organon.ttl → 辞書射影 (Option 1: proper noun のみ) の unit test。
 */
import { projectOrganonDict } from '../../scripts/organonDictProjection.mts';

const TTL = `
@prefix org1: <https://tealus.local/organon/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

org1:リュウホウ a org1:Role ;
    rdfs:label "リュウホウ" ;
    org1:alias "リュウホウ", "リュウホウさん" ;
    org1:status "confirmed" .

org1:GR電気屋 a org1:Organization ;
    rdfs:label "GR電気屋" ;
    org1:alias "GR", "GR案件" ;
    org1:vendorClass "maker" ;
    org1:status "confirmed" .

org1:サタケ a org1:Organization ;
    rdfs:label "サタケ" ;
    org1:alias "サタケ" ;
    org1:vendorClass "customer" ;
    org1:status "confirmed" .

org1:旧会社 a org1:Organization ;
    rdfs:label "旧会社" ;
    org1:status "deprecated" .

org1:候補中 a org1:Role ;
    rdfs:label "候補中" ;
    org1:status "candidate" .

org1:何か概念 a org1:Polyseme ;
    rdfs:label "何か概念" ;
    org1:status "confirmed" .
`;

describe('projectOrganonDict', () => {
  const result = projectOrganonDict(TTL);
  const byTerm = Object.fromEntries(result.map((r) => [r.term, r]));

  test('Role → category=person、aliases 収集', () => {
    // ★ #381: "リュウホウ" は恒等、"リュウホウさん" は敬称を外すと term と一致 → どちらも畳まれる
    expect(byTerm['リュウホウ']).toEqual({
      term: 'リュウホウ',
      category: 'person',
      aliases: [],
    });
  });

  test('Organization + vendorClass=maker → category=vendor', () => {
    expect(byTerm['GR電気屋'].category).toBe('vendor');
    expect(byTerm['GR電気屋'].aliases).toEqual(['GR', 'GR案件']);
  });

  test('Organization + vendorClass=customer → category=organization', () => {
    expect(byTerm['サタケ'].category).toBe('organization');
    expect(byTerm['サタケ'].aliases).toEqual([]);   // ★ #381: "サタケ" は恒等なので畳まれる
  });

  test('status=deprecated は除外', () => {
    expect(byTerm['旧会社']).toBeUndefined();
  });

  test('status=candidate は除外 (confirmed のみ)', () => {
    expect(byTerm['候補中']).toBeUndefined();
  });

  test('Role/Organization 以外の kind は除外 (Polyseme)', () => {
    expect(byTerm['何か概念']).toBeUndefined();
  });

  test('confirmed な Role+Organization のみ (3件)', () => {
    expect(result).toHaveLength(3);
  });

  test('alias は重複排除される', () => {
    const dup = projectOrganonDict(`
@prefix org1: <https://tealus.local/organon/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
org1:X a org1:Role ; rdfs:label "X" ; org1:alias "a", "a", "b" ; org1:status "confirmed" .
`);
    expect(dup[0].aliases).toEqual(['a', 'b']);
  });
});

/**
 * #381 射影の側で冗長を畳む。
 *
 * ★ organon 側の `org1:alias` は **1 語も消さない** (organon 班と相互に約束、2026-08-21)。
 *   「甲野さん」「甲野ちゃん」が organon にあるのは **誰がどう呼ばれているかという identity 情報**で、
 *   organon の役目に含まれる。冗長なのは **「STT 補正」という消費者から見たときだけ**。
 *   → 畳むのは **射影 (ここ) と Tealus 側のテーブルだけ**。
 *
 * ★ 実測 (2026-08-21、active 1199 件):
 *     ① 恒等 (alias == term)                 350
 *     ② 敬称つき かつ 素の形が別行にある        171   → ①+② = 43% が安全に消せる
 *     ③ 敬称つきで素の形が無い                  43   → ★ 消してはいけない
 *   ★ 敬称重複 287 件は 100% organon 射影由来 (自己成長辞書が作ったのは 1 件だけ)。
 */
describe('projectOrganonDict — #381 冗長 alias の畳み込み', () => {
  const project = (aliases: string[], term = '田島') => projectOrganonDict(`
@prefix org1: <https://tealus.local/organon/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
org1:T a org1:Role ; rdfs:label "${term}" ;
    org1:alias ${aliases.map((a) => `"${a}"`).join(', ')} ; org1:status "confirmed" .
`)[0].aliases;

  test('★ ① 恒等 (alias == term) は落とす', () => {
    expect(project(['田島', 'タジマ'])).toEqual(['タジマ']);
  });

  test('★ ① 敬称を外すと term と一致するものも落とす', () => {
    expect(project(['田島さん', 'タジマ'])).toEqual(['タジマ']);
    expect(project(['田島', '田島さん'])).toEqual([]);
  });

  test('★ ② 素の形が別行にあるなら、敬称つきを落とす', () => {
    expect(project(['タジマ', 'タジマさん'])).toEqual(['タジマ']);
    expect(project(['タジマ', 'タジマさん', 'タジマソン', 'タジマソンさん'])).toEqual(['タジマ', 'タジマソン']);
  });

  test('★★★ ③ 素の形が無い敬称つきは残す — 剥がすと「甲」になって「甲板」まで巻き込む', () => {
    expect(project(['甲さん', '甲ちゃん'], '甲野')).toEqual(['甲さん', '甲ちゃん']);
  });

  test('★★ 新しく短い alias を 1 つも生まない (敬称を剥がした形を追加しない)', () => {
    const out = project(['甲さん', '甲ちゃん'], '甲野');
    expect(out).not.toContain('甲');
    // 畳み込みは「落とす」だけで、元の集合に無い語を作らない
    for (const a of out) expect(['甲さん', '甲ちゃん']).toContain(a);
  });

  test('★ 敬称は さん/ちゃん/くん/君/様/さま を見る', () => {
    for (const h of ['さん', 'ちゃん', 'くん', '君', '様', 'さま']) {
      expect(project(['タジマ', `タジマ${h}`])).toEqual(['タジマ']);
    }
  });

  test('★★ 結果が alias の並び順に依存しない', () => {
    expect(project(['タジマさん', 'タジマ'])).toEqual(project(['タジマ', 'タジマさん']));
    expect(project(['タジマさん', 'タジマ'])).toEqual(['タジマ']);
  });

  test('★ 畳んだ結果も sort されている (決定論)', () => {
    expect(project(['ンヨ', 'アア', 'アアさん'])).toEqual(['アア', 'ンヨ']);
  });

  test('★ 敬称に見えるが素の形が空になるものは落とさない', () => {
    expect(project(['さん'], '田島')).toEqual(['さん']);
    expect(project(['君'], '田島')).toEqual(['君']);
  });

  test('★ 畳んだ結果が空でも entry 自体は残る (term は消さない)', () => {
    const r = projectOrganonDict(`
@prefix org1: <https://tealus.local/organon/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
org1:T a org1:Role ; rdfs:label "田島" ; org1:alias "田島" ; org1:status "confirmed" .
`);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ term: '田島', category: 'person', aliases: [] });
  });
});
