/**
 * LINE Messaging API Content API client
 *
 * LINE webhook で受信した message の binary content (= 画像 / 音声 / video / file)
 * を message ID 経由で fetch + 一時 file 保存。
 *
 * 関連:
 *   - LINE 公式 docs: https://developers.line.biz/en/reference/messaging-api/#get-content
 *   - LINE Bridge Phase 1 (= 本日 Day 17、Inbound 受信)
 *
 * @module services/lineBridge
 */
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const LINE_CONTENT_API_BASE = 'https://api-data.line.me/v2/bot/message';

/**
 * MIME type → file extension の最小 mapping
 * (= LINE が返す典型的 MIME のみ、不明 type は 'bin')
 */
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/m4a': '.m4a',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/x-m4a': '.m4a',
  'audio/wav': '.wav',
  'video/mp4': '.mp4',
};

function extensionForMime(mimeType) {
  if (!mimeType) return '.bin';
  const lower = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[lower] || '.bin';
}

/**
 * LINE Content API から binary を fetch
 *
 * @param {string} messageId - LINE webhook event の message.id
 * @param {string} accessToken - LINE channel access token
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl] - test 用 fetch mock (= default global fetch)
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 * @throws Error - response not ok, network error 等
 */
async function fetchLineContent(messageId, accessToken, options = {}) {
  if (!messageId) throw new Error('messageId is required');
  if (!accessToken) throw new Error('accessToken is required');

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch implementation not available');

  const url = `${LINE_CONTENT_API_BASE}/${encodeURIComponent(messageId)}/content`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`LINE Content API responded ${response.status} ${response.statusText}`);
  }

  const mimeType = response.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return { buffer, mimeType };
}

/**
 * LINE content buffer を local file に保存
 *
 * @param {Buffer} buffer - fetchLineContent 結果の buffer
 * @param {string} mimeType - fetchLineContent 結果の mimeType
 * @param {string} baseDir - 保存先 directory (= 既存 media/ 配下推奨)
 * @param {Object} [options]
 * @param {string} [options.subdir] - subdirectory (= e.g. 'line-images', 'line-voices')
 * @param {string} [options.originalFileName] - user が LINE で送った元ファイル名 (= type=file 時の webhook message.fileName)
 *   - 指定時: display 名 (= 返却 fileName) は原名、physical 拡張子は原名拡張子優先 → MIME 推測の順
 *   - 未指定時: display 名 = physical 名 = `${timestamp}-${random}${MIME 拡張子}`
 * @returns {Promise<{ filePath: string, relativePath: string, fileName: string, fileSize: number, mimeType: string }>}
 */
async function saveLineContentToFile(buffer, mimeType, baseDir, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('buffer must be Buffer');
  if (!baseDir) throw new Error('baseDir is required');

  const subdir = options.subdir || 'line';
  const dir = path.join(baseDir, subdir);
  await fs.mkdir(dir, { recursive: true });

  // 拡張子: originalFileName 優先 (= MIME type 不明な file に強い)、なければ MIME 推測
  const originalExt = options.originalFileName ? path.extname(options.originalFileName) : '';
  const ext = originalExt || extensionForMime(mimeType);

  const random = crypto.randomBytes(12).toString('hex');
  const physicalFileName = `${Date.now()}-${random}${ext}`;

  // display 名: originalFileName あれば原名 (= file system 危険文字 sanitize)、なければ physical 名
  const displayFileName = options.originalFileName
    ? options.originalFileName.replace(/[\/\\:*?"<>|]/g, '_')
    : physicalFileName;

  const filePath = path.join(dir, physicalFileName);
  const relativePath = path.join(subdir, physicalFileName).replace(/\\/g, '/');

  await fs.writeFile(filePath, buffer);

  return {
    filePath,
    relativePath,
    fileName: displayFileName,
    fileSize: buffer.length,
    mimeType,
  };
}

module.exports = {
  fetchLineContent,
  saveLineContentToFile,
  extensionForMime,
  LINE_CONTENT_API_BASE,
};
