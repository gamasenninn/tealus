/**
 * セッションマネージャー
 * agent_contexts テーブルの CRUD + ワークスペース初期化
 */
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import * as config from '../config.mts';
import { logger } from '../lib/logger.mts';

export interface AgentContextRow {
  agent_id: string;
  room_id: string;
  // DB 上は nullable だが、consumer (agents/deep.mts 等の processDeep/processDeepCodex) は
  // `sessionId?: string` (undefined のみ) を期待するため undefined 側に寄せる。
  // 実行時に SQL NULL が入っても、呼び出し側は truthy チェックのみで null/undefined を
  // 同一視するため挙動に影響しない。
  session_id?: string;
  workspace_path: string;
  status?: string;
  last_interaction_at?: Date;
  created_at?: Date;
  [key: string]: unknown;
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER || 'tealus'}:${process.env.DB_PASSWORD || 'tealus_dev'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tealus'}`,
});

/**
 * コンテキストを取得または新規作成
 */
export async function getOrCreateContext(agentId: string, roomId: string): Promise<AgentContextRow> {
  if (!agentId) {
    throw new Error('getOrCreateContext: agentId is required (agent-server not initialized? check earlier logs for login errors)');
  }
  if (!roomId) {
    throw new Error('getOrCreateContext: roomId is required');
  }

  // 既存を検索
  const existing = await pool.query<AgentContextRow>(
    'SELECT * FROM agent_contexts WHERE agent_id = $1 AND room_id = $2',
    [agentId, roomId]
  );

  if (existing.rows.length > 0) {
    // workspace_path は常に config から計算（移動に強い）
    const row = existing.rows[0];
    row.workspace_path = path.join(config.WORKSPACE_ROOT, agentId, roomId);
    return row;
  }

  // ワークスペースパス生成
  const workspacePath = path.join(config.WORKSPACE_ROOT, agentId, roomId);

  // 新規作成
  const result = await pool.query<AgentContextRow>(
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
export async function updateStatus(agentId: string, roomId: string, status: string): Promise<void> {
  await pool.query(
    'UPDATE agent_contexts SET status = $1, last_interaction_at = NOW() WHERE agent_id = $2 AND room_id = $3',
    [status, agentId, roomId]
  );
}

export interface ContextUpdates {
  session_id?: string | null;
  workspace_path?: string;
}

/**
 * コンテキストの各フィールドを更新
 */
export async function updateContext(agentId: string, roomId: string, updates: ContextUpdates): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
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
export function initWorkspace(workspacePath: string): void {
  try {
    const dirs = ['memory', 'files', 'temp'];
    for (const dir of dirs) {
      fs.mkdirSync(path.join(workspacePath, dir), { recursive: true });
    }

    // CLAUDE.md テンプレート作成
    const claudeMdPath = path.join(workspacePath, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, `# Tealus AIエージェント

あなたはTealusメッセンジャーのAIチームメンバーです。
ソフトウェアエンジニアリングだけでなく、ビジネス分析、リサーチ、一般知識、
歴史、地理、時事問題など幅広いトピックに対応してください。

## 役割
- チームメンバーとして対等に会話する
- 質問には正確に答え、わからない場合は正直に伝える
- Web検索が必要な場合は積極的に使う
- ファイル作成やデータ分析も対応する
- 応答は日本語で行う

## 制約
- このワークスペース外のファイルにアクセスしない
- rm -rf や破壊的コマンドを実行しない
- 機密情報（APIキー、パスワード等）をファイルに書き出さない

## 共有メモリ

過去の会話で蓄積した記憶や user 情報は @memory/MEMORY.md を参照してください。
このファイルは Light agent が能動的に書き、Deep agent (本 session) からは読み取りで参照します。
`);
    }

    // room_settings.json 初期化
    const roomSettingsPath = path.join(workspacePath, 'room_settings.json');
    if (!fs.existsSync(roomSettingsPath)) {
      fs.writeFileSync(roomSettingsPath, JSON.stringify({ response_mode: 'auto', enabled: true }, null, 2) + '\n');
    }

    // MEMORY.md 初期化
    const memoryMdPath = path.join(workspacePath, 'memory', 'MEMORY.md');
    if (!fs.existsSync(memoryMdPath)) {
      fs.writeFileSync(memoryMdPath, '## Memory Index\n');
    }

    logger.debug(`Workspace initialized: ${workspacePath}`);
  } catch (err) {
    logger.error(`Workspace init error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
