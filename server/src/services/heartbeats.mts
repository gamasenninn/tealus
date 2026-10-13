/**
 * 見張りの鼓動 (#595、docs/09 §3.2)
 *
 * ★ Tealus の部品が `POST /api/bot/heartbeat` で「生きている」を送り、ここで 1 行だけ覚える (上書き)。
 * ★ 部屋には何も流さない —— 鼓動は知らせではない (1 分ごとに投稿すると部屋が埋まる)。
 */
import { pool } from '../db/pool.mts';

/** 名前に使える文字。設定ファイルと印に書くので、空白や記号を避ける */
const NAME_RE = /^[A-Za-z0-9._:-]{1,64}$/;
/** info の上限 (JSON の文字数)。時刻を 2〜3 個入れる程度の用途なので、大きなものは受けない */
export const HEARTBEAT_INFO_MAX = 2000;

export interface Heartbeat {
  last_seen: Date;
  info: Record<string, unknown>;
}

export function isHeartbeatName(v: unknown): v is string {
  return typeof v === 'string' && NAME_RE.test(v);
}

/** 本文を確かめる。★ 400 で返す理由は日本語で (部品を作る人が読む) */
export function validateHeartbeatBody(body: unknown): { name: string; info: Record<string, unknown> } | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isHeartbeatName(b.name)) {
    return 'name は英数字と . _ : - だけの 1〜64 文字で書いてください';
  }
  const info = b.info ?? {};
  if (typeof info !== 'object' || info === null || Array.isArray(info)) {
    return 'info はオブジェクトで送ってください';
  }
  if (JSON.stringify(info).length > HEARTBEAT_INFO_MAX) {
    return `info が大きすぎます (${HEARTBEAT_INFO_MAX} 字まで)`;
  }
  return { name: b.name, info: info as Record<string, unknown> };
}

export async function recordHeartbeat(userId: string, name: string, info: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO heartbeats (user_id, name, last_seen, info) VALUES ($1, $2, now(), $3)
     ON CONFLICT (user_id, name) DO UPDATE SET last_seen = now(), info = EXCLUDED.info`,
    [userId, name, JSON.stringify(info)],
  );
}

export async function getHeartbeat(userId: string, name: string): Promise<Heartbeat | null> {
  const { rows } = await pool.query<Heartbeat>(
    'SELECT last_seen, info FROM heartbeats WHERE user_id = $1 AND name = $2',
    [userId, name],
  );
  return rows[0] ?? null;
}
