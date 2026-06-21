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
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DEFAULT_CATALOG_FILE = path.join(__dirname, '../../config/line-groups.json');
const LINE_GROUP_SUMMARY_BASE = 'https://api.line.me/v2/bot/group';
const MAX_SNIPPET_CHARS = 100;

/**
 * catalog file を読む (= 存在しない場合は空 object)
 *
 * @param {string} filePath
 * @returns {Object}
 */
function readCatalog(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const raw = JSON.parse(text);
    // ★ _comment 等 meta key は読み取り時に保持 (= user の注記をそのまま残す)
    return raw || {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    logger.warn(`[lineGroupCatalog] readCatalog failed: ${e.message}, treating as empty`);
    return {};
  }
}

/**
 * catalog を atomic write (= temp file + rename) で書き出す
 *
 * @param {string} filePath
 * @param {Object} catalog
 */
function writeCatalogAtomic(filePath, catalog) {
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
 * @param {string} groupId
 * @param {string} accessToken
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl] - test 用
 * @returns {Promise<{ groupName: string, pictureUrl: string|null }>}
 */
async function fetchGroupSummary(groupId, accessToken, options = {}) {
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
  const data = await response.json();
  return { groupName: data.groupName || null, pictureUrl: data.pictureUrl || null };
}

/**
 * catalog entry を upsert (= name 既取得 group は API call skip)
 *
 * @param {string} groupId
 * @param {Object} eventContext
 * @param {string} [eventContext.sender] - 送信者名 / userId
 * @param {string} [eventContext.snippet] - message text snippet (= 100 char に truncate)
 * @param {string} [eventContext.timestamp] - ISO timestamp (= default 現在時刻)
 * @param {Object} [options]
 * @param {string} [options.filePath] - file path override
 * @param {string} [options.accessToken] - env LINE_CHANNEL_ACCESS_TOKEN override
 * @param {Function} [options.fetchImpl] - test 用
 * @returns {Promise<{ updated: boolean, fetchedName: boolean }>}
 */
async function upsertGroupEntry(groupId, eventContext = {}, options = {}) {
  if (!groupId) throw new Error('groupId is required');

  const filePath = options.filePath || process.env.LINE_GROUP_CATALOG_FILE || DEFAULT_CATALOG_FILE;
  const accessToken = options.accessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const timestamp = eventContext.timestamp || new Date().toISOString();

  const catalog = readCatalog(filePath);
  const existing = catalog[groupId] || {};

  // name 未取得時のみ LINE API call (= rate limit 配慮)
  let fetchedName = false;
  let name = existing.name || null;
  if (!name && accessToken) {
    try {
      const summary = await fetchGroupSummary(groupId, accessToken, { fetchImpl: options.fetchImpl });
      name = summary.groupName;
      fetchedName = true;
    } catch (e) {
      logger.warn(`[lineGroupCatalog] fetchGroupSummary failed for ${groupId}: ${e.message}`);
      // name は null のまま、★ 次回 webhook で再 try
    }
  }

  const snippet = eventContext.snippet
    ? String(eventContext.snippet).slice(0, MAX_SNIPPET_CHARS)
    : (existing.last_message_snippet || null);

  const entry = {
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
    logger.warn(`[lineGroupCatalog] writeCatalogAtomic failed: ${e.message}`);
    return { updated: false, fetchedName };
  }
}

/**
 * cache 済 group name を読む (= #309 案A、sender label の「@グループ名」用)
 *
 * @param {string} groupId
 * @param {Object} [options]
 * @param {string} [options.filePath] - file path override
 * @returns {string|null} group name (= 未取得 / 未収集は null)
 */
function readGroupName(groupId, options = {}) {
  if (!groupId) return null;
  const filePath = options.filePath || process.env.LINE_GROUP_CATALOG_FILE || DEFAULT_CATALOG_FILE;
  const entry = readCatalog(filePath)[groupId];
  return (entry && entry.name) || null;
}

module.exports = {
  readCatalog,
  writeCatalogAtomic,
  fetchGroupSummary,
  upsertGroupEntry,
  readGroupName,
  DEFAULT_CATALOG_FILE,
  LINE_GROUP_SUMMARY_BASE,
  MAX_SNIPPET_CHARS,
};
