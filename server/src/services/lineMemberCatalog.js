/**
 * LINE group member catalog (= 送信者 userId → displayName の取得 + file cache、#309 案A)
 *
 * LINE Bridge で投影する message に「誰が送ったか」を添えるため、webhook の
 * source.userId から LINE API getGroupMemberProfile で displayName を取得し、
 * server/config/line-members.json に atomic write で cache する。
 *
 * 設計原則 (= lineGroupCatalog 同型):
 * - 既取得 userId は LINE API call skip (= rate limit 配慮)
 * - atomic write (= temp file + rename) で並行 webhook の race condition 回避
 * - LINE API fail / file write fail は silent (= null degrade、webhook dispatch を阻害しない)
 *
 * @module services/lineMemberCatalog
 */
const path = require('path');
const logger = require('../utils/logger');
const { readCatalog, writeCatalogAtomic } = require('./lineGroupCatalog');

const DEFAULT_MEMBER_CATALOG_FILE = path.join(__dirname, '../../config/line-members.json');
const LINE_GROUP_BASE = 'https://api.line.me/v2/bot/group';

/**
 * LINE API GET /v2/bot/group/{groupId}/member/{userId} で member profile fetch
 *
 * @param {string} groupId
 * @param {string} userId
 * @param {string} accessToken
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl] - test 用
 * @returns {Promise<{ displayName: string|null, pictureUrl: string|null, userId: string }>}
 */
async function fetchMemberProfile(groupId, userId, accessToken, options = {}) {
  if (!groupId) throw new Error('groupId is required');
  if (!userId) throw new Error('userId is required');
  if (!accessToken) throw new Error('accessToken is required');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch implementation not available');

  const url = `${LINE_GROUP_BASE}/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`LINE getGroupMemberProfile responded ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return { displayName: data.displayName || null, pictureUrl: data.pictureUrl || null, userId };
}

/**
 * userId の displayName を返す (= cache 優先、未取得時のみ LINE API call)
 *
 * @param {string} groupId
 * @param {string} userId
 * @param {string} accessToken
 * @param {Object} [options]
 * @param {string} [options.filePath] - cache file override
 * @param {Function} [options.fetchImpl] - test 用
 * @param {string} [options.now] - fetched_at override (= test 用)
 * @returns {Promise<string|null>} displayName、取得不可は null (= caller 側で degrade)
 */
async function getMemberDisplayName(groupId, userId, accessToken, options = {}) {
  if (!userId || !accessToken) return null;

  const filePath = options.filePath || process.env.LINE_MEMBER_CATALOG_FILE || DEFAULT_MEMBER_CATALOG_FILE;
  const catalog = readCatalog(filePath);
  const existing = catalog[userId];
  if (existing && existing.name) return existing.name;

  let profile;
  try {
    profile = await fetchMemberProfile(groupId, userId, accessToken, { fetchImpl: options.fetchImpl });
  } catch (e) {
    logger.warn(`[lineMemberCatalog] fetchMemberProfile failed for ${userId}: ${e.message}`);
    return null;
  }
  if (!profile.displayName) return null;

  catalog[userId] = {
    name: profile.displayName,
    picture_url: profile.pictureUrl || null,
    last_group_id: groupId,
    fetched_at: options.now || new Date().toISOString(),
  };
  try {
    writeCatalogAtomic(filePath, catalog);
  } catch (e) {
    logger.warn(`[lineMemberCatalog] writeCatalogAtomic failed: ${e.message}`);
  }
  return profile.displayName;
}

module.exports = {
  fetchMemberProfile,
  getMemberDisplayName,
  DEFAULT_MEMBER_CATALOG_FILE,
  LINE_GROUP_BASE,
};
