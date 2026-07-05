-- #327 変換辞書のテーブル化。
-- 設計判断（Issue #327 / memory: project_dict_table_ontology_paradigm_choice）:
--   organon = 軸が可変な正規オントロジー → file(YAML) のまま。
--   Teals変換辞書 = garble→term+読み の固定構造 → table が自然（実行時 source of truth）。
--   organon export(file) は任意の一方向 import で source='organon' 行として取り込む（契約変更なし）。
--   学習分は source='auto' 行。手動編集は source='manual'。→ merge ロジックが消え、補正段は
--   active 行を precedence(manual>auto>imported) 順に引くだけ。
--
-- 2テーブルに正規化する理由:
--   reading / category は term ごと、source / status / count は別名ごと（学習対象）。
--   同一 alias が別 term を指す衝突（パラダイム裁定の対象）も alias 行の source/status で解決可能。

-- 正準エンティティ（term = 出力される確定表記）。alias 文字列を跨いで一意。
CREATE TABLE IF NOT EXISTS dictionary_terms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term        TEXT NOT NULL,
    category    VARCHAR(32) NOT NULL DEFAULT 'other',
    reading     TEXT,                                   -- ひらがな読み(pykakasi自動+手動上書き)。音韻ゲートが使う。NULL可
    source      VARCHAR(16) NOT NULL DEFAULT 'manual'
                CHECK (source IN ('organon', 'manual', 'auto')),
    status      VARCHAR(16) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (term)
);

-- garble→term の別名マッピング。1行=1(term, alias)。各行が自分の来歴(source/status/count)を持つ。
CREATE TABLE IF NOT EXISTS dictionary_aliases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term_id     UUID NOT NULL REFERENCES dictionary_terms(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,                          -- 転写ブレ / 崩れ
    source      VARCHAR(16) NOT NULL DEFAULT 'manual'
                CHECK (source IN ('organon', 'manual', 'auto')),
    status      VARCHAR(16) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'rejected')),  -- rejected = tombstone。再 import で復活させない
    count       INTEGER NOT NULL DEFAULT 0,             -- 学習で直された回数(auto の確信度・頻度)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (term_id, alias)
);

-- alias 文字列での逆引き(補正段の lookup と衝突検出)、term 順引き(UI/組み立て)
CREATE INDEX IF NOT EXISTS idx_dictionary_aliases_alias ON dictionary_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_dictionary_aliases_term  ON dictionary_aliases(term_id);
