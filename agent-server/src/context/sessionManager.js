/**
 * セッションマネージャー
 * agent_contexts テーブルの CRUD + ワークスペース初期化
 */
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../lib/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER || 'tealus'}:${process.env.DB_PASSWORD || 'tealus_dev'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tealus'}`,
});

/**
 * コンテキストを取得または新規作成
 */
async function getOrCreateContext(agentId, roomId) {
  // 既存を検索
  const existing = await pool.query(
    'SELECT * FROM agent_contexts WHERE agent_id = $1 AND room_id = $2',
    [agentId, roomId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // ワークスペースパス生成
  const workspacePath = path.join(config.WORKSPACE_ROOT, agentId, roomId);

  // 新規作成
  const result = await pool.query(
    `INSERT INTO agent_contexts (agent_id, room_id, workspace_path)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [agentId, roomId, workspacePath]
  );

  // ワークスペースディレクトリ初期化
  initWorkspace(workspacePath);

  logger.info(`New context created: agent=${agentId}, room=${roomId}`);
  return result.rows[0];
}

/**
 * ステータスを更新
 */
async function updateStatus(agentId, roomId, status) {
  await pool.query(
    'UPDATE agent_contexts SET status = $1, last_interaction_at = NOW() WHERE agent_id = $2 AND room_id = $3',
    [status, agentId, roomId]
  );
}

/**
 * コンテキストの各フィールドを更新
 */
async function updateContext(agentId, roomId, updates) {
  const fields = [];
  const values = [];
  let paramIndex = 1;

  if (updates.session_id !== undefined) {
    fields.push(`session_id = $${paramIndex++}`);
    values.push(updates.session_id);
  }
  if (updates.workspace_path !== undefined) {
    fields.push(`workspace_path = $${paramIndex++}`);
    values.push(updates.workspace_path);
  }

  if (fields.length === 0) return;

  fields.push(`last_interaction_at = NOW()`);
  values.push(agentId, roomId);

  await pool.query(
    `UPDATE agent_contexts SET ${fields.join(', ')} WHERE agent_id = $${paramIndex++} AND room_id = $${paramIndex}`,
    values
  );
}

/**
 * ワークスペースディレクトリを初期化
 */
function initWorkspace(workspacePath) {
  try {
    const dirs = ['memory', 'files', 'temp'];
    for (const dir of dirs) {
      fs.mkdirSync(path.join(workspacePath, dir), { recursive: true });
    }

    // CLAUDE.md テンプレート作成
    const claudeMdPath = path.join(workspacePath, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, `# Agent Constraints

- このワークスペース外のファイルにアクセスしない
- rm -rf や危険なコマンドを実行しない
- 外部APIへの直接アクセスは行わない
- 応答は日本語で行う
`);
    }

    // MEMORY.md 初期化
    const memoryMdPath = path.join(workspacePath, 'memory', 'MEMORY.md');
    if (!fs.existsSync(memoryMdPath)) {
      fs.writeFileSync(memoryMdPath, '## Memory Index\n');
    }

    logger.debug(`Workspace initialized: ${workspacePath}`);
  } catch (err) {
    logger.error(`Workspace init error: ${err.message}`);
  }
}

module.exports = {
  getOrCreateContext,
  updateStatus,
  updateContext,
  initWorkspace,
  pool,
};
