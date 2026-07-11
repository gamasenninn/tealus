/**
 * #327 変換辞書 repository — dictionary_terms / dictionary_aliases への素の行アクセス。
 *
 * 責務はデータアクセスに限定する。precedence(manual>auto>imported) やパラダイムモードの
 * 裁定は loader 段の責務（ここには焼き込まない）。肝は upsertAlias の tombstone 尊重 + count 加算。
 */
const { pool } = require('../db/pool.mts');

/**
 * term を term 文字列で upsert。reading / description は COALESCE で「null なら既存を消さない」。
 * （import が null-reading を持ってきても手動で入れた読みを消さない安全策）
 */
async function upsertTerm({ term, category = 'other', reading = null, description = null, source = 'manual', status = 'active' }) {
  const { rows } = await pool.query(
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

async function getTermByName(term) {
  const { rows } = await pool.query('SELECT * FROM dictionary_terms WHERE term = $1', [term]);
  return rows[0] || null;
}

/**
 * (term_id, alias) を upsert。既存 active/pending なら count を加算（status は保持）。
 * status='rejected'(tombstone) の行は尊重して no-op（却下が学習で復活しない）。
 * status は INSERT 時のみ適用（既定 'active'。自己成長 hook は 'pending' で入れて後で昇格）。
 * @returns {{row: object|null, applied: boolean}}
 */
async function upsertAlias({ termId, alias, source = 'auto', count = 1, status = 'active' }) {
  const { rows } = await pool.query(
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
  const existing = await pool.query(
    'SELECT * FROM dictionary_aliases WHERE term_id = $1 AND alias = $2',
    [termId, alias],
  );
  return { row: existing.rows[0] || null, applied: false };
}

async function setAliasStatus(aliasId, status) {
  const { rows } = await pool.query(
    'UPDATE dictionary_aliases SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [aliasId, status],
  );
  return rows[0] || null;
}

/**
 * active な term に active な alias を grouped で束ねて返す（loader / seed 用）。
 * rejected の term / alias は除外。alias は count 降順。
 * @returns {Array<{id,term,category,reading,description,aliases:string[]}>}
 */
async function listActiveVocabulary() {
  const { rows } = await pool.query(
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

/**
 * 辞書育成レビュー用の別名一覧（term 情報を join）。pending を先頭に。
 * @param {object} [opts]
 * @param {'auto'|'all'|'rejected'} [opts.scope='auto'] - auto=自己成長分 / all=全部 / rejected=却下済
 * @param {string} [opts.search] - term/alias 部分一致
 */
async function listAliasesForReview({ scope = 'auto', search = '' } = {}) {
  const where = [];
  const params = [];
  if (scope === 'auto') where.push("a.source = 'auto'");
  else if (scope === 'rejected') where.push("a.status = 'rejected'");
  if (search) {
    params.push(`%${search}%`);
    where.push(`(t.term ILIKE $${params.length} OR a.alias ILIKE $${params.length})`);
  }
  const { rows } = await pool.query(
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
async function approveAlias(aliasId) {
  const { rows } = await pool.query(
    "UPDATE dictionary_aliases SET status = 'active', source = 'manual', updated_at = NOW() WHERE id = $1 RETURNING *",
    [aliasId],
  );
  return rows[0] || null;
}

/** 人間が却下 → rejected(tombstone。source は来歴として保持) */
async function rejectAlias(aliasId) {
  const { rows } = await pool.query(
    "UPDATE dictionary_aliases SET status = 'rejected', updated_at = NOW() WHERE id = $1 RETURNING *",
    [aliasId],
  );
  return rows[0] || null;
}

/** term の読みを上書き(自動 backfill の人間修正。次回以降の音韻ゲートに効く) */
async function setTermReading(termId, reading) {
  const { rows } = await pool.query(
    'UPDATE dictionary_terms SET reading = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [termId, reading],
  );
  return rows[0] || null;
}

/** 語(term)一覧。読み/description/category 編集の「語」ビュー用。別名数も返す。 */
async function listTerms({ search = '' } = {}) {
  const params = [];
  let where = '';
  if (search) { params.push(`%${search}%`); where = 'WHERE t.term ILIKE $1'; }
  const { rows } = await pool.query(
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

/** term の部分更新(reading/description/category)。指定されたフィールドだけ書く。 */
async function updateTerm(termId, fields = {}) {
  const sets = [];
  const params = [termId];
  for (const key of ['reading', 'description', 'category']) {
    if (fields[key] !== undefined) { params.push(fields[key]); sets.push(`${key} = $${params.length}`); }
  }
  if (!sets.length) return null;
  const { rows } = await pool.query(
    `UPDATE dictionary_terms SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  upsertTerm,
  getTermByName,
  upsertAlias,
  setAliasStatus,
  listActiveVocabulary,
  listAliasesForReview,
  approveAlias,
  rejectAlias,
  setTermReading,
  listTerms,
  updateTerm,
};
