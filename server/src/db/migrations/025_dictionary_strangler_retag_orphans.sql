-- #331 strangler cleanup: organon dock 対象外 orphan の provenance を organon→manual へ是正。
--
-- 背景:
--   #331 で organon → 辞書は「RDF 契約 (organon.ttl) を pull import」に一本化した。
--   organon dock が運ぶのは proper noun のみ = category person / vendor / organization の3つ
--   (projectOrganonDict: Role→person, Organization→vendor|organization)。
--   それ以外の category (product / place / term / role 等) は dock の責務外 = base/manual に残す設計。
--
--   しかし旧 seed 経路 (scripts/seed_dictionary.mts, guideline.json 由来) が product/place/term/role を
--   source='organon' で投入していた。これらは pull では二度と再確認されない orphan なので、
--   来歴を manual (=人間所有の base) に是正し、dock 管理行と明確に分離する。
--
-- 冪等: 再実行時は対象 (source='organon' かつ dock 対象外 category) が 0 件になり no-op。
-- データ削除は一切なし (source 列の付け替えのみ = 可逆)。
-- 注意: proper noun orphan (category person/vendor/organization かつ現 organon.ttl 射影に無い
--   曖昧な裸姓 8 件) は organon の curation 方針 (曖昧 garble に hard entry を付けない) を尊重し、
--   本 migration では触らない = 別途 Q0 判断に委ねる。

-- term: dock 対象外 category の organon 行 → manual
UPDATE dictionary_terms
   SET source = 'manual', updated_at = NOW()
 WHERE source = 'organon'
   AND category NOT IN ('person', 'vendor', 'organization');

-- alias: 上記 term に紐づく organon alias → manual (auto 学習 alias は来歴保持のため触らない)
UPDATE dictionary_aliases a
   SET source = 'manual', updated_at = NOW()
  FROM dictionary_terms t
 WHERE a.term_id = t.id
   AND a.source = 'organon'
   AND t.category NOT IN ('person', 'vendor', 'organization');
