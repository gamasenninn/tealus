/**
 * LINE group → Tealus room mapping loader (= Phase 2.3、6/6 Day 21 確立)
 *
 * mapping は ★ JSON file (= server/config/line-group-mappings.json) で持つ。
 * webhook 毎に file 読み込み = restart 不要、★ user が file 編集すれば次 webhook で即反映。
 *
 * D2 object form 採用 + pure string form 後方互換:
 *   - object form: { "groupId": { "room_id": "...", "description": "..." } }
 *   - pure form:   { "groupId": "roomId" } (= 旧 env LINE_GROUP_TO_ROOM 移行 path)
 *
 * 優先順:
 *   1. file (= LINE_GROUP_TO_ROOM_FILE / config/line-group-mappings.json) 存在 → file 読む
 *   2. file なし + env LINE_GROUP_TO_ROOM あり → env fallback (= 既存運用そのまま動く)
 *   3. 両方なし → 空 map
 *
 * @module services/lineGroupMappings
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.mts';

export const DEFAULT_MAPPINGS_FILE = path.join(import.meta.dirname, '../../config/line-group-mappings.json');

/** mapping file の object form entry */
interface GroupMappingObjectForm {
  room_id?: string;
  description?: string;
}

/**
 * file 内容 (= object form / pure form mixed) を flat map { groupId: roomId } に正規化
 *
 * @param raw - JSON parse 結果
 * @returns { groupId: roomId } flat form
 */
export function normalizeMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [groupId, target] of Object.entries(raw as Record<string, unknown>)) {
    if (groupId.startsWith('_')) continue; // _comment / _format 等 meta key は skip
    if (typeof target === 'string') {
      result[groupId] = target; // pure form
    } else if (target && typeof target === 'object' && (target as GroupMappingObjectForm).room_id) {
      result[groupId] = (target as GroupMappingObjectForm).room_id as string; // object form
    }
    // ★ 不正 form は silent skip (= 起動阻害しない)
  }
  return result;
}

/**
 * mapping file から flat map を load
 *
 * @param options.filePath - file path override (= test 用)
 * @param options.envValue - env LINE_GROUP_TO_ROOM 値 override (= test 用)
 * @returns { groupId: roomId } flat form
 */
export function loadGroupToRoomMap(
  options: { filePath?: string; envValue?: string } = {}
): Record<string, string> {
  const filePath = options.filePath || process.env.LINE_GROUP_TO_ROOM_FILE || DEFAULT_MAPPINGS_FILE;
  const envValue = options.envValue !== undefined ? options.envValue : process.env.LINE_GROUP_TO_ROOM;

  // Priority 1: file
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const raw = JSON.parse(text) as unknown;
    return normalizeMap(raw);
  } catch (e) {
    // file なし or parse fail → fallback chain
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`[lineGroupMappings] file load failed: ${e instanceof Error ? e.message : String(e)}, falling back to env`);
    }
  }

  // Priority 2: env LINE_GROUP_TO_ROOM
  if (envValue) {
    try {
      const raw = JSON.parse(envValue) as unknown;
      return normalizeMap(raw);
    } catch (e) {
      logger.warn(`[lineGroupMappings] env LINE_GROUP_TO_ROOM JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Priority 3: empty
  return {};
}

/**
 * 特定 group の mapping meta info (= description 等) を取得
 * routes/line.js では使わないが、admin / debug 用に export
 *
 * @returns { room_id, description } or null
 */
export function getGroupMappingMeta(
  groupId: string,
  options: { filePath?: string } = {}
): { room_id: string | undefined; description: string | null } | null {
  const filePath = options.filePath || process.env.LINE_GROUP_TO_ROOM_FILE || DEFAULT_MAPPINGS_FILE;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const raw = JSON.parse(text) as Record<string, unknown>;
    const target = raw[groupId];
    if (typeof target === 'string') return { room_id: target, description: null };
    if (target && typeof target === 'object') {
      const obj = target as GroupMappingObjectForm;
      return { room_id: obj.room_id, description: obj.description || null };
    }
    return null;
  } catch {
    return null;
  }
}
