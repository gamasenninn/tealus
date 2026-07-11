/**
 * LINE group catalog (= 自動収集の group name ↔ ID 対応表、Phase 2.3、6/6 Day 21 確立)
 *
 * webhook 受信時に source.groupId を抽出 + LINE API getGroupSummary で name fetch、
 * server/config/line-groups.json に atomic write で蓄積。
 *
 * 用途: ★ user が ★ ★ ★ ★ ★ この file を open するだけで、★ group name ↔ ID 対応表を確認可能
 * (= console room や DB UI なしで、★ ★ ★ Unix 流の read-only view file)。
 *
 * 設計原則:
 * - name 既取得 group は LINE API call skip (= rate limit 配慮、ほぼ webhook 毎の API call なし)
 * - atomic write (= temp file + rename) で 並行 webhook の race condition 回避
 * - LINE API fail / file write fail は silent error (= webhook dispatch を阻害しない)
 * - last_message_snippet は 100 char 上限 (= 個人情報 leak 抑制 + file 肥大化抑制)
 *
 * @module services/lineGroupCatalog
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.mts';
import type { FetchLike } from './lineBridge.mts';

export const DEFAULT_CATALOG_FILE = path.join(import.meta.dirname, '../../config/line-groups.json');
export const LINE_GROUP_SUMMARY_BASE = 'https://api.line.me/v2/bot/group';
export const MAX_SNIPPET_CHARS = 100;

/** catalog file 全体 (= entry のほか _comment 等 meta key も混在するので値は unknown) */
export type CatalogFile = Record<string, unknown>;

/** group catalog の 1 entry */
export interface GroupCatalogEntry {
  name: string | null;
  last_seen_at: string;
  last_sender: string | null;
  last_message_snippet: string | null;
  first_seen_at: string;
}

/**
 * catalog file を読む (= 存在しない場合は空 object)
 */
export function readCatalog(filePath: string): CatalogFile {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const raw = JSON.parse(text) as CatalogFile | null;
    // ★ _comment 等 meta key は読み取り時に保持 (= user の注記をそのまま残す)
    return raw || {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    logger.warn(`[lineGroupCatalog] readCatalog failed: ${e instanceof Error ? e.message : String(e)}, treating as empty`);
    return {};
  }
}

/**
 * catalog を atomic write (= temp file + rename) で書き出す
 */
export function writeCatalogAtomic(filePath: string, catalog: CatalogFile): void {
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // exist OK
  }
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const text = JSON.stringify(catalog, null, 2);
  fs.writeFileSync(tempPath, text, 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * LINE API GET /v2/bot/group/{groupId}/summary で group name fetch
 *
 * @param options.fetchImpl - test 用
 */
export async function fetchGroupSummary(
  groupId: string,
  accessToken: string,
  options: { fetchImpl?: FetchLike } = {}
): Promise<{ groupName: string | null; pictureUrl: string | null }> {
  if (!groupId) throw new Error('groupId is required');
  if (!accessToken) throw new Error('accessToken is required');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch implementation not available');

  const url = `${LINE_GROUP_SUMMARY_BASE}/${encodeURIComponent(groupId)}/summary`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`LINE getGroupSummary responded ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as { groupName?: string; pictureUrl?: string };
  return { groupName: data.groupName || null, pictureUrl: data.pictureUrl || null };
}

/**
 * catalog entry を upsert (= name 既取得 group は API call skip)
 *
 * @param eventContext.sender - 送信者名 / userId
 * @param eventContext.snippet - message text snippet (= 100 char に truncate)
 * @param eventContext.timestamp - ISO timestamp (= default 現在時刻)
 * @param options.filePath - file path override
 * @param options.accessToken - env LINE_CHANNEL_ACCESS_TOKEN override
 * @param options.fetchImpl - test 用
 */
export async function upsertGroupEntry(
  groupId: string,
  eventContext: { sender?: string; snippet?: string; timestamp?: string } = {},
  options: { filePath?: string; accessToken?: string; fetchImpl?: FetchLike } = {}
): Promise<{ updated: boolean; fetchedName: boolean }> {
  if (!groupId) throw new Error('groupId is required');

  const filePath = options.filePath || process.env.LINE_GROUP_CATALOG_FILE || DEFAULT_CATALOG_FILE;
  const accessToken = options.accessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const timestamp = eventContext.timestamp || new Date().toISOString();

  const catalog = readCatalog(filePath);
  const existing = (catalog[groupId] || {}) as Partial<GroupCatalogEntry>;

  // name 未取得時のみ LINE API call (= rate limit 配慮)
  let fetchedName = false;
  let name: string | null = existing.name || null;
  if (!name && accessToken) {
    try {
      const summary = await fetchGroupSummary(groupId, accessToken, { fetchImpl: options.fetchImpl });
      name = summary.groupName;
      fetchedName = true;
    } catch (e) {
      logger.warn(`[lineGroupCatalog] fetchGroupSummary failed for ${groupId}: ${e instanceof Error ? e.message : String(e)}`);
      // name は null のまま、★ 次回 webhook で再 try
    }
  }

  const snippet = eventContext.snippet
    ? String(eventContext.snippet).slice(0, MAX_SNIPPET_CHARS)
    : (existing.last_message_snippet || null);

  const entry: GroupCatalogEntry = {
    name: name || existing.name || null,
    last_seen_at: timestamp,
    last_sender: eventContext.sender || existing.last_sender || null,
    last_message_snippet: snippet,
    first_seen_at: existing.first_seen_at || timestamp,
  };

  catalog[groupId] = entry;

  try {
    writeCatalogAtomic(filePath, catalog);
    return { updated: true, fetchedName };
  } catch (e) {
    logger.warn(`[lineGroupCatalog] writeCatalogAtomic failed: ${e instanceof Error ? e.message : String(e)}`);
    return { updated: false, fetchedName };
  }
}

/**
 * cache 済 group name を読む (= #309 案A、sender label の「@グループ名」用)
 *
 * @param options.filePath - file path override
 * @returns group name (= 未取得 / 未収集は null)
 */
export function readGroupName(
  groupId: string | null | undefined,
  options: { filePath?: string } = {}
): string | null {
  if (!groupId) return null;
  const filePath = options.filePath || process.env.LINE_GROUP_CATALOG_FILE || DEFAULT_CATALOG_FILE;
  const entry = readCatalog(filePath)[groupId] as Partial<GroupCatalogEntry> | undefined;
  return (entry && entry.name) || null;
}
