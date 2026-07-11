/**
 * #327 変換辞書 repository — dictionary_terms / dictionary_aliases への素の行アクセス。
 *
 * 責務はデータアクセスに限定する。precedence(manual>auto>imported) やパラダイムモードの
 * 裁定は loader 段の責務（ここには焼き込まない）。肝は upsertAlias の tombstone 尊重 + count 加算。
 */
import { pool } from '../db/pool.mts';

/** dictionary_terms / dictionary_aliases の source (DB CHECK 制約と同一) */
export type DictionarySource = 'organon' | 'manual' | 'auto';
/** dictionary_terms.status (DB CHECK 制約と同一) */
export type DictionaryTermStatus = 'active' | 'rejected';
/** dictionary_aliases.status (024 で 'pending' 追加済み) */
export type DictionaryAliasStatus = 'active' | 'pending' | 'rejected';

/** dictionary_terms の行 */
export interface DictionaryTermRow {
  id: string;
  term: string;
  category: string;
  reading: string | null;
  description: string | null;
  source: DictionarySource;
  status: DictionaryTermStatus;
  created_at: Date;
  updated_at: Date;
}

/** dictionary_aliases の行 */
export interface DictionaryAliasRow {
  id: string;
  term_id: string;
  alias: string;
  source: DictionarySource;
  status: DictionaryAliasStatus;
  count: number;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertTermInput {
  term: string;
  category?: string;
  reading?: string | null;
  description?: string | null;
  source?: DictionarySource;
  status?: DictionaryTermStatus;
}

/**
 * term を term 文字列で upsert。reading / description は COALESCE で「null なら既存を消さない」。
 * （import が null-reading を持ってきても手動で入れた読みを消さない安全策）
 */
export async function upsertTerm({ term, category = 'other', reading = null, description = null, source = 'manual', status = 'active' }: UpsertTermInput): Promise<DictionaryTermRow> {
  const { rows } = await pool.query<DictionaryTermRow>(
    `INSERT INTO dictionary_terms (term, category, reading, description, source, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (term) DO UPDATE SET
       category    = EXCLUDED.category,
       reading     = COALESCE(EXCLUDED.reading, dictionary_terms.reading),
       description = COALESCE(EXCLUDED.description, dictionary_terms.description),
       source      = EXCLUDED.source,
       status      = EXCLUDED.status,
       updated_at  = NOW()
     RETURNING *`,
    [term, category, reading, description, source, status],
  );
  return rows[0];
}

export async function getTermByName(term: string): Promise<DictionaryTermRow | null> {
  const { rows } = await pool.query<DictionaryTermRow>('SELECT * FROM dictionary_terms WHERE term = $1', [term]);
  return rows[0] || null;
}

export interface UpsertAliasInput {
  termId: string;
  alias: string;
  source?: DictionarySource;
  count?: number;
  status?: DictionaryAliasStatus;
}

/**
 * (term_id, alias) を upsert。既存 active/pending なら count を加算（status は保持）。
 * status='rejected'(tombstone) の行は尊重して no-op（却下が学習で復活しない）。
 * status は INSERT 時のみ適用（既定 'active'。自己成長 hook は 'pending' で入れて後で昇格）。
 */
export async function upsertAlias({ termId, alias, source = 'auto', count = 1, status = 'active' }: UpsertAliasInput): Promise<{ row: DictionaryAliasRow | null; applied: boolean }> {
  const { rows } = await pool.query<DictionaryAliasRow>(
    `INSERT INTO dictionary_aliases (term_id, alias, source, count, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (term_id, alias) DO UPDATE SET
       count      = dictionary_aliases.count + EXCLUDED.count,
       updated_at = NOW()
     WHERE dictionary_aliases.status <> 'rejected'
     RETURNING *`,
    [termId, alias, source, count, status],
  );
  if (rows[0]) return { row: rows[0], applied: true };
  // DO UPDATE の WHERE が false = tombstone に当たった。現行を返して applied=false
  const existing = await pool.query<DictionaryAliasRow>(
    'SELECT * FROM dictionary_aliases WHERE term_id = $1 AND alias = $2',
    [termId, alias],
  );
  return { row: existing.rows[0] || null, applied: false };
}

export async function setAliasStatus(aliasId: string, status: DictionaryAliasStatus): Promise<DictionaryAliasRow | null> {
  const { rows } = await pool.query<DictionaryAliasRow>(
    'UPDATE dictionary_aliases SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [aliasId, status],
  );
  return rows[0] || null;
}

/** listActiveVocabulary の行 (term + active alias 束) */
export interface ActiveVocabularyRow {
  id: string;
  term: string;
  category: string;
  reading: string | null;
  description: string | null;
  aliases: string[];
}

/**
 * active な term に active な alias を grouped で束ねて返す（loader / seed 用）。
 * rejected の term / alias は除外。alias は count 降順。
 */
export async function listActiveVocabulary(): Promise<ActiveVocabularyRow[]> {
  const { rows } = await pool.query<ActiveVocabularyRow>(
    `SELECT t.id, t.term, t.category, t.reading, t.description,
            COALESCE(
              array_agg(a.alias ORDER BY a.count DESC, a.alias)
              FILTER (WHERE a.id IS NOT NULL AND a.status = 'active'),
              '{}'
            ) AS aliases
     FROM dictionary_terms t
     LEFT JOIN dictionary_aliases a ON a.term_id = t.id
     WHERE t.status = 'active'
     GROUP BY t.id
     ORDER BY t.term`,
  );
  return rows;
}

// --- #327 辞書育成UI (admin レビュー) 用 ------------------------------------

/** listAliasesForReview の行 (alias + term 情報 join) */
export interface AliasReviewRow {
  alias_id: string;
  alias: string;
  source: DictionarySource;
  status: DictionaryAliasStatus;
  count: number;
  updated_at: Date;
  term_id: string;
  term: string;
  category: string;
  reading: string | null;
}

/**
 * 辞書育成レビュー用の別名一覧（term 情報を join）。pending を先頭に。
 * @param opts.scope - auto=自己成長分 / all=全部 / rejected=却下済
 * @param opts.search - term/alias 部分一致
 */
export async function listAliasesForReview({ scope = 'auto', search = '' }: { scope?: 'auto' | 'all' | 'rejected'; search?: string } = {}): Promise<AliasReviewRow[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (scope === 'auto') where.push("a.source = 'auto'");
  else if (scope === 'rejected') where.push("a.status = 'rejected'");
  if (search) {
    params.push(`%${search}%`);
    where.push(`(t.term ILIKE $${params.length} OR a.alias ILIKE $${params.length})`);
  }
  const { rows } = await pool.query<AliasReviewRow>(
    `SELECT a.id AS alias_id, a.alias, a.source, a.status, a.count, a.updated_at,
            t.id AS term_id, t.term, t.category, t.reading
       FROM dictionary_aliases a JOIN dictionary_terms t ON t.id = a.term_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (a.status = 'pending') DESC, a.updated_at DESC
       LIMIT 500`,
    params,
  );
  return rows;
}

/** 人間が承認 → active に昇格 + source='manual'(請け合い=最上位・import が触れない) */
export async function approveAlias(aliasId: string): Promise<DictionaryAliasRow | null> {
  const { rows } = await pool.query<DictionaryAliasRow>(
    "UPDATE dictionary_aliases SET status = 'active', source = 'manual', updated_at = NOW() WHERE id = $1 RETURNING *",
    [aliasId],
  );
  return rows[0] || null;
}

/** 人間が却下 → rejected(tombstone。source は来歴として保持) */
export async function rejectAlias(aliasId: string): Promise<DictionaryAliasRow | null> {
  const { rows } = await pool.query<DictionaryAliasRow>(
    "UPDATE dictionary_aliases SET status = 'rejected', updated_at = NOW() WHERE id = $1 RETURNING *",
    [aliasId],
  );
  return rows[0] || null;
}

/** term の読みを上書き(自動 backfill の人間修正。次回以降の音韻ゲートに効く) */
export async function setTermReading(termId: string, reading: string | null): Promise<DictionaryTermRow | null> {
  const { rows } = await pool.query<DictionaryTermRow>(
    'UPDATE dictionary_terms SET reading = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [termId, reading],
  );
  return rows[0] || null;
}

/** listTerms の行 (term + 別名数) */
export interface TermListRow {
  id: string;
  term: string;
  category: string;
  reading: string | null;
  description: string | null;
  source: DictionarySource;
  status: DictionaryTermStatus;
  alias_count: number;
}

/** 語(term)一覧。読み/description/category 編集の「語」ビュー用。別名数も返す。 */
export async function listTerms({ search = '' }: { search?: string } = {}): Promise<TermListRow[]> {
  const params: string[] = [];
  let where = '';
  if (search) { params.push(`%${search}%`); where = 'WHERE t.term ILIKE $1'; }
  const { rows } = await pool.query<TermListRow>(
    `SELECT t.id, t.term, t.category, t.reading, t.description, t.source, t.status,
            COUNT(a.id) FILTER (WHERE a.status <> 'rejected')::int AS alias_count
       FROM dictionary_terms t
       LEFT JOIN dictionary_aliases a ON a.term_id = t.id
       ${where}
       GROUP BY t.id
       ORDER BY t.term
       LIMIT 1000`,
    params,
  );
  return rows;
}

export interface UpdateTermFields {
  reading?: string | null;
  description?: string | null;
  category?: string;
}

/** term の部分更新(reading/description/category)。指定されたフィールドだけ書く。 */
export async function updateTerm(termId: string, fields: UpdateTermFields = {}): Promise<DictionaryTermRow | null> {
  const sets: string[] = [];
  const params: Array<string | null> = [termId];
  for (const key of ['reading', 'description', 'category'] as const) {
    const value = fields[key];
    if (value !== undefined) { params.push(value); sets.push(`${key} = $${params.length}`); }
  }
  if (!sets.length) return null;
  const { rows } = await pool.query<DictionaryTermRow>(
    `UPDATE dictionary_terms SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
