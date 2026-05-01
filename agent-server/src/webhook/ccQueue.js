/**
 * cc-queue: Claude Code session ↔ Tealus リアルタイム連携の file beacon writer
 *
 * #213 Phase A: agent-server が message.created webhook で `@cc-{project}` mention を
 * 検知したら、`~/.tealus/cc-queue/{project}.jsonl` に payload を 1 行 append する。
 * Claude Code session 側は当該 file を Monitor で監視し、新着行で wake する。
 *
 * 設計: stateless / convention-based。project 一覧の管理は無し、mention の suffix が
 * そのまま file 名になる。複数 project が並列稼働しても各 jsonl が独立。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_QUEUE_DIR = path.join(os.homedir(), '.tealus', 'cc-queue');

// `@cc-{project}` mention 検出。
// - 単語境界: 直前は word char (英数_) 以外 (メールアドレス内の偽 match を回避)
// - project 名: 英小文字 / 数字 / ハイフン (lowercase 規約)
// - 複数 mention は最初の 1 つを返す
const CC_MENTION_RE = /(?<![A-Za-z0-9_])@cc-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/;

/**
 * メッセージ content から @cc-{project} の project 名を抽出する。
 * @param {string|null|undefined} content
 * @returns {string|null} project 名、無ければ null
 */
function extractCcProject(content) {
  if (typeof content !== 'string' || content.length === 0) return null;
  const match = content.match(CC_MENTION_RE);
  return match ? match[1] : null;
}

/**
 * project 用の jsonl file に payload を 1 行 append する。
 * queue dir が無ければ再帰的に作成。
 *
 * @param {string} project - project 識別子 (例: "tealus")
 * @param {object} payload - シリアライズして書き込む event payload
 * @param {string} [baseDir] - queue dir (default: ~/.tealus/cc-queue/)
 * @returns {string} 書き込み先 file path
 */
function appendCcEvent(project, payload, baseDir = DEFAULT_QUEUE_DIR) {
  if (!project || typeof project !== 'string') {
    throw new Error('appendCcEvent: project is required');
  }
  fs.mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${project}.jsonl`);
  fs.appendFileSync(filePath, JSON.stringify(payload) + '\n');
  return filePath;
}

/**
 * 自己ループ防止: sender が cc bot user list に含まれていればスキップ。
 * Claude Code session が自分の reply で再 wake されないための防御。
 *
 * @param {string|null|undefined} senderId
 * @param {Set<string>|null|undefined} skipSet - skip 対象 sender ID Set
 * @returns {boolean} skip すべきなら true
 */
function shouldSkipCcSender(senderId, skipSet) {
  if (!senderId || !skipSet || skipSet.size === 0) return false;
  return skipSet.has(senderId);
}

/**
 * env (default `process.env.CC_SKIP_SENDER_IDS`、CSV) から skip Set を構築。
 * テスト用に直接 string 渡し可。
 *
 * @param {string} [envVal=process.env.CC_SKIP_SENDER_IDS]
 * @returns {Set<string>}
 */
function loadSkipSenderIds(envVal = process.env.CC_SKIP_SENDER_IDS) {
  if (!envVal) return new Set();
  return new Set(envVal.split(',').map(s => s.trim()).filter(Boolean));
}

module.exports = {
  extractCcProject,
  appendCcEvent,
  shouldSkipCcSender,
  loadSkipSenderIds,
  DEFAULT_QUEUE_DIR,
};
