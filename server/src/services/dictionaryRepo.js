/**
 * #327 変換辞書 repository — dictionary_terms / dictionary_aliases への素の行アクセス。
 *
 * 責務はデータアクセスに限定する。precedence(manual>auto>imported) やパラダイムモードの
 * 裁定は loader 段の責務（ここには焼き込まない）。肝は upsertAlias の tombstone 尊重 + count 加算。
 */
const pool = require('../db/pool');

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
 * (term_id, alias) を upsert。既存 active なら count を加算。
 * status='rejected'(tombstone) の行は尊重して no-op（却下が学習で復活しない）。
 * @returns {{row: object|null, applied: boolean}}
 */
async function upsertAlias({ termId, alias, source = 'auto', count = 1 }) {
  const { rows } = await pool.query(
    `INSERT INTO dictionary_aliases (term_id, alias, source, count, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (term_id, alias) DO UPDATE SET
       count      = dictionary_aliases.count + EXCLUDED.count,
       updated_at = NOW()
     WHERE dictionary_aliases.status <> 'rejected'
     RETURNING *`,
    [termId, alias, source, count],
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

module.exports = {
  upsertTerm,
  getTermByName,
  upsertAlias,
  setAliasStatus,
  listActiveVocabulary,
};
