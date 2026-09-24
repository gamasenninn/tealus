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

/**
 * 末尾の敬称を 1 つだけ外した形。敬称が無い / 外すと空になるなら null。
 *
 * ★ 2026-09-24 に export した。**畳んだ側と引く側で同じ規則を使うため** —— agent-server の
 *   `confirmMarks.mts` が 〔要確認〕の語を台帳に照らすとき、ここで畳んだ敬称つきは
 *   台帳に無い。同じ表を 2 か所に置くと、片方に敬称を足したときに静かにずれる。
 */
export function stripHonorific(s: string): string | null {
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

/**
 * ttl を subject 単位にまとめる。★ 射影と「全 kind の表層」で **同じ読み方**を使うために切り出した
 * (2026-09-15)。★★ 2 か所で別々に parse すると、片方だけ述語を足したときに静かにずれる。
 */
function parseSubjects(ttl: string): Map<string, SubjectAcc> {
  const quads = new Parser().parse(ttl);
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
  return bySubject;
}

export function projectOrganonDict(ttl: string): ProjectedTerm[] {
  const bySubject = parseSubjects(ttl);
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

/**
 * ★ **消費側が 2 つあるので、ものさしを分ける** (2026-09-15)。
 *
 * `projectOrganonDict` は **Role / Organization だけ**を残す —— 辞書テーブル経由の消費者
 * (朝礼 / 本体の補正段) に合わせた粒度で、Location / Polyseme 等は落ちる。
 * ★★ 一方 **通話履歴 (別リポ) は organon.ttl を全 kind 直読み**していて、
 *   Location も Polyseme も prompt に載る。
 *
 * ★★★ 実測 (2026-09-15): 射影の表層 **867** / 全 kind **1,298**。
 *   `鹿沼` `芝駐` `宇都宮` は射影に無い (Location)。
 *   → ★ 通話履歴の訂正を射影の canon で測ると **地名の訂正が丸ごと「canon 外」に落ちる**。
 *   実際 `神山 → 鹿沼` が canon 外として上位に出ていた (14 日で 7 件)。
 *
 * ★★★★ この区別は `correctionLedger.mts` の doc コメントに書いてあったのに、
 *   **実装は射影を選んでいた。** 書いてあることと、していることが違っていた。
 *
 * ★ status は `confirmed` のみ —— 通話履歴側 (`load_organon_aliases.build`) と揃える。
 * ★★ label も表層に入れる。organon の entry は正式名を alias に含めないことがあり、
 *   alias だけ見ると素の正式名が「未収載」に化ける (向こうの実装と同じ判断)。
 */
export function collectConfirmedSurfaces(ttl: string): Set<string> {
  const out = new Set<string>();
  for (const p of parseSubjects(ttl).values()) {
    if (p.status !== 'confirmed') continue;
    const label = (p.label || '').trim();
    if (label) out.add(label);
    for (const a of p.aliases) {
      const t = a.trim();
      if (t) out.add(t);
    }
  }
  return out;
}
