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

/**
 * 敬称 (#381)。**長いものから試す** — 「くん」と「君」のように片方が他方の部分でなくても、
 * 将来足したときに短い方が先に当たる事故を防ぐため、長さ降順で固定する。
 */
const HONORIFICS = ['ちゃん', 'さま', 'さん', 'くん', '様', '君'];

/** 末尾の敬称を 1 つだけ外した形。敬称が無い / 外すと空になるなら null */
function stripHonorific(s: string): string | null {
  for (const h of HONORIFICS) {
    if (s.length > h.length && s.endsWith(h)) return s.slice(0, -h.length);
  }
  return null;
}

/**
 * 冗長な alias を畳む (#381)。**落とすだけで、新しい語は 1 つも作らない。**
 *
 * ```
 * ① 恒等                  alias == term                     → 落とす
 * ①' 敬称を外すと term      田島さん (term=田島)             → 落とす
 * ②  素の形が別行にある      タジマ がある上での タジマさん         → 落とす
 * ★③ 素の形が無い敬称つき    甲さん/甲ちゃん (term=甲野)          → ★ 残す
 * ```
 *
 * ★ ③ を残す理由: 一律に敬称を剥がすと `甲さん` → `甲` になり、**「甲板」「甲高い」まで
 *   巻き込む**。安全な規則は「敬称を剥がす」ではなく **「素の形が既に別行にあるときだけ、
 *   敬称つきの行を落とす」**。これなら新しく短い alias は 1 つも生まれない。
 *
 * ★ 判定は **元の集合**に対して行う (畳みながら判定すると並び順で結果が変わる)。
 *
 * ★ organon 側 (`org1:alias`) には触れない。あちらでは呼び名が identity 情報で、
 *   冗長なのは「STT 補正」という消費者から見たときだけ (issue #381 / 2026-08-21 の相互の約束)。
 */
function foldRedundantAliases(term: string, aliases: string[]): string[] {
  const original = new Set(aliases);
  return aliases.filter((a) => {
    if (a === term) return false;                       // ①
    const bare = stripHonorific(a);
    if (bare === null) return true;                     // 敬称なし → 残す
    if (bare === term) return false;                    // ①'
    return !original.has(bare);                         // ② 素の形があるなら落とす
  });
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
    const deduped = [...new Set(a.aliases.map((x) => x.trim()).filter(Boolean))].sort();
    // #381 恒等・敬称重複を畳む (organon 側は触らず、消費者側の粒度に合わせる)
    const aliases = foldRedundantAliases(term, deduped);
    out.push({ term, category, aliases });
  }
  return out;
}
