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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../lib/logger.mts';

interface CcAlias {
  mention: string;
  project: string;
  regex: RegExp;
}

interface CcAliasesFile {
  aliases?: Array<{ mention?: unknown; project?: unknown }>;
}

const DEFAULT_QUEUE_DIR = path.join(os.homedir(), '.tealus', 'cc-queue');

// `@cc-{project}` mention 検出 (#215 先頭マッチング方式)。
// - **メッセージ (or 行) の先頭** に @cc-{project} がある場合のみ match。
//   /m flag で multi-line 対応 (改行直後も「先頭」扱い)
// - project 名: 英小文字 / 数字 / ハイフン (lowercase 規約)
// - 複数 mention は最初の 1 つを返す
// - 自己ループ防止の主要メカニズム: AI reply は本文中 (先頭ではない位置) で
//   @cc-* を引用するため、自然に skip される (CC_SKIP_SENDER_IDS は defense in depth)
const CC_MENTION_RE = /^@cc-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/m;

// alias mention 設定ファイルの path 解決 (#263、Level 2)。
// AGENT_CONFIG_DIR env で override 可能 (test isolation 用、production では unset で default)。
function getAliasesConfigPath(): string {
  const configDir = process.env.AGENT_CONFIG_DIR || path.join(import.meta.dirname, '..', '..', 'config');
  return path.join(configDir, 'cc-aliases.json');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * cc-aliases.json を読み込んで alias entry の配列を返す。
 * 各 entry は { mention, project, regex } を持つ。
 * file 不在 / parse 失敗時は空配列 (graceful degrade)。
 */
function loadAliases(): CcAlias[] {
  const configPath = getAliasesConfigPath();
  try {
    if (!fs.existsSync(configPath)) return [];
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8')) as CcAliasesFile;
    if (!Array.isArray(data.aliases)) return [];
    return data.aliases
      .filter((a): a is { mention: string; project: string } => !!a && typeof a.mention === 'string' && typeof a.project === 'string'
        && a.mention.length > 0 && a.project.length > 0)
      .map((a) => ({
        mention: a.mention,
        project: a.project,
        // 行頭マッチ (#215 同 stance) + case-insensitive + word boundary で誤 match 回避
        regex: new RegExp(`^@${escapeRegex(a.mention)}\\b`, 'im'),
      }));
  } catch (err) {
    logger.error(`[cc-aliases] failed to load ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// alias cache (module load 時に lazy initialize、reloadAliases() で invalidate)
let _aliasesCache: CcAlias[] | null = null;

function getAliases(): CcAlias[] {
  if (_aliasesCache === null) _aliasesCache = loadAliases();
  return _aliasesCache;
}

/**
 * cache を invalidate して次回 getAliases() で再読込する。
 * test isolation + 将来の hot-reload endpoint で使う。
 */
function reloadAliases(): CcAlias[] {
  _aliasesCache = null;
  return getAliases();
}

/**
 * 後方互換: 旧 `@Claude` hardcode 時代の env override (#263 初期実装)。
 * 設定ファイル登場後 (Level 2) は cc-aliases.json が source of truth、本 helper は legacy。
 */
function getClaudeDefaultProject(): string {
  return process.env.CLAUDE_DEFAULT_PROJECT || 'tealus';
}

/**
 * メッセージ content から cc-queue routing 用の project 名を抽出する。
 * - `@cc-{project}` mention があればその project
 * - cc-aliases.json の alias 一覧を順に check、最初に match した alias の project
 * - backward compat: alias の mention が "claude" (case-insensitive) で
 *   `CLAUDE_DEFAULT_PROJECT` env が設定されていれば、そちらを優先
 * - どれも無ければ null
 *
 * @param content
 * @returns project 名、無ければ null
 */
function extractCcProject(content: string | null | undefined): string | null {
  if (typeof content !== 'string' || content.length === 0) return null;
  const ccMatch = content.match(CC_MENTION_RE);
  if (ccMatch) return ccMatch[1];
  const aliases = getAliases();
  for (const alias of aliases) {
    if (alias.regex.test(content)) {
      // legacy env override: 旧実装互換 (cc-aliases.json 未登場時の deploy 救済)
      if (alias.mention.toLowerCase() === 'claude' && process.env.CLAUDE_DEFAULT_PROJECT) {
        return process.env.CLAUDE_DEFAULT_PROJECT;
      }
      return alias.project;
    }
  }
  return null;
}

/**
 * project 用の jsonl file に payload を 1 行 append する。
 * queue dir が無ければ再帰的に作成。
 *
 * @param project - project 識別子 (例: "tealus")
 * @param payload - シリアライズして書き込む event payload
 * @param baseDir - queue dir (default: ~/.tealus/cc-queue/)
 * @returns 書き込み先 file path
 */
function appendCcEvent(project: string, payload: Record<string, unknown>, baseDir: string = DEFAULT_QUEUE_DIR): string {
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
 * @param senderId
 * @param skipSet - skip 対象 sender ID Set
 * @returns skip すべきなら true
 */
function shouldSkipCcSender(senderId: string | null | undefined, skipSet: Set<string> | null | undefined): boolean {
  if (!senderId || !skipSet || skipSet.size === 0) return false;
  return skipSet.has(senderId);
}

/**
 * env (default `process.env.CC_SKIP_SENDER_IDS`、CSV) から skip Set を構築。
 * テスト用に直接 string 渡し可。
 *
 * @param envVal
 */
function loadSkipSenderIds(envVal: string | undefined = process.env.CC_SKIP_SENDER_IDS): Set<string> {
  if (!envVal) return new Set();
  return new Set(envVal.split(',').map(s => s.trim()).filter(Boolean));
}

export {
  extractCcProject,
  appendCcEvent,
  shouldSkipCcSender,
  loadSkipSenderIds,
  getClaudeDefaultProject,
  loadAliases,
  reloadAliases,
  getAliasesConfigPath,
  DEFAULT_QUEUE_DIR,
};
