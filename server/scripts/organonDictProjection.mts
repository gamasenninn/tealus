/**
 * #331 organon dock: organon.ttl (RDF 公開契約) → 辞書射影 (pure)。
 *
 * Option 1: organon dock は proper noun のみを運ぶ。
 *   - `a org1:Role`         → category='person'
 *   - `a org1:Organization` → vendorClass が maker/manufacturer/parts_supplier なら 'vendor'、他は 'organization'
 *   - status='confirmed' のみ (deprecated/candidate は除外)
 *   - term = rdfs:label / aliases = org1:alias (複数)
 * product/place/term 等の汎用・別種語彙は organon の責務外 (base/manual に残す)。
 *
 * owlrl 導出 triple (推移的 escalation・sameAs 反射) は契約 export に含まれない前提だが、
 * 射影は Role/Organization + status で絞るため、混じっていても無視される。
 */
import { Parser } from 'n3';

const ORG = 'https://tealus.local/organon/';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

/** vendorClass → dict category (すべて CORRECTION_CATEGORIES 内に落とす) */
const VENDOR_CLASSES = new Set(['maker', 'manufacturer', 'parts_supplier']);

export interface ProjectedTerm {
  term: string;
  category: string; // 'person' | 'vendor' | 'organization'
  aliases: string[];
}

interface SubjectAcc {
  type?: string;
  label?: string;
  status?: string;
  vendorClass?: string;
  aliases: string[];
}

export function projectOrganonDict(ttl: string): ProjectedTerm[] {
  const parser = new Parser();
  const quads = parser.parse(ttl);

  const bySubject = new Map<string, SubjectAcc>();
  const acc = (s: string): SubjectAcc => {
    let a = bySubject.get(s);
    if (!a) { a = { aliases: [] }; bySubject.set(s, a); }
    return a;
  };

  for (const q of quads) {
    const s = q.subject.value;
    const p = q.predicate.value;
    const o = q.object.value;
    if (p === RDF_TYPE) acc(s).type = o;
    else if (p === RDFS_LABEL) acc(s).label = o;
    else if (p === `${ORG}status`) acc(s).status = o;
    else if (p === `${ORG}vendorClass`) acc(s).vendorClass = o;
    else if (p === `${ORG}alias`) acc(s).aliases.push(o);
  }

  const out: ProjectedTerm[] = [];
  for (const a of bySubject.values()) {
    if (a.status !== 'confirmed') continue;
    let category: string;
    if (a.type === `${ORG}Role`) category = 'person';
    else if (a.type === `${ORG}Organization`) {
      category = a.vendorClass && VENDOR_CLASSES.has(a.vendorClass) ? 'vendor' : 'organization';
    } else continue; // Role/Organization 以外 (polyseme 等) は organon dock の対象外

    const term = (a.label || '').trim();
    if (!term) continue;
    // alias は重複排除 + 決定論のため sort (順序は辞書用途に無関係)
    const aliases = [...new Set(a.aliases.map((x) => x.trim()).filter(Boolean))].sort();
    out.push({ term, category, aliases });
  }
  return out;
}
