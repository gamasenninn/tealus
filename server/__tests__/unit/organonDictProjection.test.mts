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
    expect(byTerm['リュウホウ']).toEqual({
      term: 'リュウホウ',
      category: 'person',
      aliases: ['リュウホウ', 'リュウホウさん'],
    });
  });

  test('Organization + vendorClass=maker → category=vendor', () => {
    expect(byTerm['GR電気屋'].category).toBe('vendor');
    expect(byTerm['GR電気屋'].aliases).toEqual(['GR', 'GR案件']);
  });

  test('Organization + vendorClass=customer → category=organization', () => {
    expect(byTerm['サタケ'].category).toBe('organization');
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
