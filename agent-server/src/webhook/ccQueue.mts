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
import { publish } from './ccSubscribers.mts';

interface CcAlias {
  mention: string;
  project: string;
  regex: RegExp;
}

interface CcAliasesFile {
  aliases?: Array<{ mention?: unknown; project?: unknown }>;
}

const DEFAULT_QUEUE_DIR = path.join(os.homedir(), '.tealus', 'cc-queue');

/**
 * queue dir の解決。`CC_QUEUE_DIR` で差し替え可能 (テスト隔離 / 運用で場所を変えたい場合)。
 * ★ 呼び出しのたびに env を読む — module 読込時に固定すると、env を後から設定する
 *   テストで本番 ~/.tealus/cc-queue を掴んでしまうため (#235 と同じ罠)。
 */
function getCcQueueDir(): string {
  return process.env.CC_QUEUE_DIR || DEFAULT_QUEUE_DIR;
}

// #335 cc-bridge 受付エコーの表示時間 (ms)。processing を出してこの時間後に idle で消す。
const CC_ACK_TTL_MS = parseInt(process.env.CC_ACK_TTL_MS || '5000', 10);

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
 * #387 同報の上限。1 便がこれ以上のセッションを起こすことはない。
 * 実測 (cc-queue 全 1323 便) の最大は 3 宛先なので、通常運用では当たらない。
 * **暴走したときに止まる高さ**として置いている。
 */
const CC_FANOUT_MAX = 5;

// 1 行目の先頭から**連続して並ぶ** mention 群 (`@cc-a @cc-b @cc-c`)。
// ★ CC_MENTION_RE と違い /m を付けない。**最初の行だけ**を見るための意図的な差。
const CC_HEAD_RUN_RE = new RegExp(`^((?:@cc-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?[ \\t]*)+)`);
const CC_MENTION_G_RE = /@cc-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/g;
// 行頭 (どの行でもよい) の mention を全部拾う。#386 の「捨てた宛先」検出に使う
const CC_MENTION_LINE_HEAD_G_RE = /^@cc-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/gm;

/** 最初の非空行。無ければ空文字 */
function firstNonEmptyLine(content: string): string {
  return content.split('\n').find((l) => l.trim().length > 0) || '';
}

/** 文字列中の `@cc-name` を出現順・重複排除で取り出す */
function ccNamesIn(s: string): string[] {
  CC_MENTION_G_RE.lastIndex = 0;
  return [...new Set([...s.matchAll(CC_MENTION_G_RE)].map((m) => m[1]))];
}

/**
 * 配送先の一覧を返す (#387 同報)。
 *
 * ★ **1 行目の先頭に並べたものだけ**を宛先とする。`@cc-a @cc-b @cc-c` の形。
 *   それ以外は `extractCcProject()` と同じ 1 宛先に落ちる (alias 経由もここに含む)。
 *
 * ★ なぜ「1 行目の先頭」に限るのか —— **測ったから**。cc-queue の全 1323 便で:
 * ```
 *   1 行目の先頭に並べた便          2 件 → 2 件とも本物の同報 (2026-08-21 / 08-23)
 *   1 行目以外の行頭に mention がある便 2 件 → 2 件とも引用・案内表 = 配ったら誤配
 * ```
 *   両者は母集団で完全に排他だった。全体を `/m` で走査する実装にすると、
 *   **拾いたい 2 件は増えず、誤配だけが 2 件増える** (案内表の便は 7 セッションを起こす)。
 *
 * ★ 自己ループ防止 (docs/06 §6.1 = 「行頭にあるか」だけが防御) もこの限定で保たれる。
 *   AI の返信が本文中で `@cc-*` を引用しても、1 行目の先頭には来ない。
 *
 * @returns 配送先の配列 (重複排除・出現順・最大 CC_FANOUT_MAX)。宛先が無ければ空配列
 */
function extractCcProjects(content: string | null | undefined): string[] {
  if (typeof content !== 'string' || content.length === 0) return [];
  const run = firstNonEmptyLine(content).match(CC_HEAD_RUN_RE);
  if (run) {
    const names = ccNamesIn(run[1]);
    if (names.length > 1) return names.slice(0, CC_FANOUT_MAX);
  }
  // 単一宛先 (従来経路)。alias もここで解決される
  const single = extractCcProject(content);
  return single ? [single] : [];
}

/**
 * 行頭に書かれているのに配送しなかった宛先を返す (#386 黙って捨てない)。
 *
 * 対象は **行頭の `@cc-`** だけ。本文中の引用 (`宛先は @cc-organon と書く`) では鳴らさない
 * —— AI 同士が宛先を説明するたびに鳴ると、警告が通常の会話に埋もれて「見えない」に戻る
 * ([[detectUnroutedAddressHint]] と同じ stance)。
 *
 * ★ 上限超過分もここに現れる: `delivered` が CC_FANOUT_MAX で切られているため、
 *   1 行目に並んだ 6 番目以降が差分として出る。
 *
 * @param delivered 実際に配送した project 名 (extractCcProjects の結果)
 */
function findDroppedCcMentions(content: string | null | undefined, delivered: readonly string[]): string[] {
  if (typeof content !== 'string' || content.length === 0) return [];
  const deliveredSet = new Set(delivered);
  CC_MENTION_LINE_HEAD_G_RE.lastIndex = 0;
  const lineHead = [...content.matchAll(CC_MENTION_LINE_HEAD_G_RE)].map((m) => m[1]);
  // 1 行目の先頭に並べた分は行頭 1 つ分しか掛からないので、そちらも合わせて見る
  const headRun = firstNonEmptyLine(content).match(CC_HEAD_RUN_RE);
  const candidates = new Set([...lineHead, ...(headRun ? ccNamesIn(headRun[1]) : [])]);
  return [...candidates].filter((n) => !deliveredSet.has(n));
}

// #359 (a) 宛先を書いたつもりで配送されなかった便を拾うための signal。
// 社内の宛先記法「【organon班 → 本体班】」= 矢印のあとに 班。2026-08-20 の実害はこの形。
const TEAM_ARROW_RE = /→\s*\S*班/;
// 行頭の `@cc-` 記法を試したが CC_MENTION_RE に届かなかったもの (`@cc-Tealus` / `@cc-` 等)。
const CC_MENTION_ATTEMPT_RE = /^@cc-/m;

/** #359 (a) の判定結果。null = 宛先を書いたようには見えない。 */
type UnroutedAddressHint = 'team-arrow' | 'malformed-cc-mention' | null;

/**
 * 配送されなかった便のうち「宛先を書いたつもり」に見えるものを判別する (#359 (a))。
 *
 * 2026-08-20 の実害: `【organon班 → 本体班】🔴 6 件目…` が 3 日間どの queue にも入らず、
 * **送信側にも受信側にも痕跡が残らなかった**。issue の選択肢 6「silent をやめる」の実装。
 *
 * ★ 精度を優先する。配送されなかった便を全部 info に上げると、通常の会話で埋もれて
 *   「見えない」に戻る。**鳴らない方に倒し、鳴ったら本物**を狙う:
 * - 見るのは **最初の非空行だけ** — 長い返信が後段で他班のやり取りを引用しても鳴らない
 * - 本文中 (行頭でない) の `@cc-` 引用では鳴らさない — AI 同士が宛先を説明するたびに鳴るため
 *
 * ★ 呼び出し側は extractCcProject() が null のときだけ呼ぶこと。routing 済みの便に
 *   対して呼んでも null を返すが (下の `!CC_MENTION_RE.test`)、意味のある使い方ではない。
 */
function detectUnroutedAddressHint(content: string | null | undefined): UnroutedAddressHint {
  if (typeof content !== 'string' || content.length === 0) return null;
  const firstLine = content.split('\n').find((l) => l.trim().length > 0);
  if (!firstLine) return null;
  // 規約どおりに match するなら routing 済み = ここでは扱わない
  if (CC_MENTION_RE.test(content)) return null;
  if (CC_MENTION_ATTEMPT_RE.test(firstLine)) return 'malformed-cc-mention';
  if (TEAM_ARROW_RE.test(firstLine)) return 'team-arrow';
  return null;
}

/**
 * jsonl の行数上限 (#214)。超えたら末尾 80% を残して古い行を捨てる。
 *
 * ★ 不変条件: この trim は read → rewrite なので、**1 つの cc-queue dir を
 *   複数の agent-server プロセスが共有してはいけない** (docs/05 参照)。
 */
const CC_QUEUE_MAX_LINES_DEFAULT = 2000;
const CC_QUEUE_KEEP_RATIO = 0.8;

function ccQueueMaxLines(): number {
  const raw = parseInt(process.env.CC_QUEUE_MAX_LINES || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : CC_QUEUE_MAX_LINES_DEFAULT;
}

/**
 * jsonl が上限を超えていたら末尾 keep 行だけ残す。
 * temp file に書いて rename する = 読み手 (tail -F / stream) が途中の状態を見ない。
 */
function trimIfNeeded(filePath: string): void {
  const max = ccQueueMaxLines();
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;   // append 直後なので通常あり得ないが、trim の失敗で append を壊さない
  }
  const lines = content.split('\n').filter((l) => l !== '');
  if (lines.length <= max) return;

  const keep = Math.floor(max * CC_QUEUE_KEEP_RATIO);
  const dropped = lines.length - keep;
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, lines.slice(-keep).join('\n') + '\n');
    fs.renameSync(tmpPath, filePath);
    logger.info(`[cc-queue] 上限 ${max} 行を超えたため切り詰めました: ${path.basename(filePath)} (${dropped} 行破棄 → ${keep} 行)`);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* noop */ }
    logger.warn(`[cc-queue] 切り詰めに失敗しました (append 自体は成功): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * project 用の jsonl file に payload を 1 行 append し、
 * 接続中の HTTP 購読者にも同じ payload を配る (#214)。
 *
 * ★ append 自体は #213 から不変。file beacon (`tail -n 0 -F`) の挙動は変わらない。
 *   publish / trim はその**後ろに足した副作用**で、どちらが失敗しても append は成立済み。
 *
 * @param project - project 識別子 (例: "tealus")
 * @param payload - シリアライズして書き込む event payload
 * @param baseDir - queue dir (default: ~/.tealus/cc-queue/)
 * @returns 書き込み先 file path
 */
function appendCcEvent(project: string, payload: Record<string, unknown>, baseDir: string = getCcQueueDir()): string {
  if (!project || typeof project !== 'string') {
    throw new Error('appendCcEvent: project is required');
  }
  fs.mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${project}.jsonl`);
  fs.appendFileSync(filePath, JSON.stringify(payload) + '\n');

  publish(project, payload);   // #214 HTTP 購読者 (認可は publish 側で room 単位に絞る)
  trimIfNeeded(filePath);

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

/**
 * #335 cc-bridge 受付エコー — mention 投入時に「届きました」を出し、TTL 後に idle で消す。
 *
 * 内部エージェント (Light/Deep) は同一プロセスで「考え中」を出せるが、cc-bridge は
 * tealus(受付) と Claude Code session(応答) が別プロセスで、beacon に積むだけの fire-and-forget
 * ゆえユーザーに何も見えない → 「投げたものが受理されたか分からず一か八か待つ」心理を生む。
 * 受付時に typing-indicator 風の status を 1 回出し、TTL 後に idle で消すことでこれを解消する。
 *
 * 完了 (idle) は listener の応答完了とは無関係に TTL で出す (別プロセスの完了を tealus は
 * 知らない)。listener が TTL より早く応答した場合は、その返信 message 到着で client 側が
 * 自動的に status を消すため二重にはならない (idle は冪等)。
 *
 * pushStatus は best-effort: 失敗しても beacon は既に積まれているので握りつぶす。
 *
 * ★ #387 で `projects` (複数) を受けるようにした。**宛先ごとに呼んではいけない** ——
 *   status は room に 1 つしか無いので、N 回押し込むと互いに上書きし合い、
 *   最後の 1 件しか見えない (しかも TTL の idle が N 個走って先に消える)。
 *   同報は「1 回のエコーに宛先を並べる」が正しい形。
 */
export interface CcAckDeps {
  /** 配送先 (同報なら複数)。空配列では呼ばないこと */
  projects: string[];
  roomId: string;
  /** POST /bot/status 相当 (本番は botApi.pushStatus)。 */
  pushStatus: (roomId: string, status: string, message?: string) => Promise<unknown>;
  /** 表示時間 (ms)。既定 CC_ACK_TTL_MS。 */
  ttlMs?: number;
}
function emitCcAck({ projects, roomId, pushStatus, ttlMs = CC_ACK_TTL_MS }: CcAckDeps): void {
  const label = projects.map((p) => `cc-${p}`).join(' / ');
  // ★ 'processing' ではなく 'relayed'。これは「このボットが処理中」ではなく
  //   「**別セッションへ中継した**」の意味で、止められる処理が無い。
  //   'processing' のままだと client が中断ボタンを出し、押しても何も起きない
  //   (2026-08-30 実測。#399 で表示条件を広げたときに巻き込んだ)。
  //   ★★ client 側の対は `client/src/utils/agentStatus.ts` の RELAYED_STATUS。片方だけ変えると壊れる。
  void pushStatus(roomId, 'relayed', `${label} に届きました。応答をお待ちください…`).catch(() => {});
  // ★ 1 行残す。これが無いと「relayed で出たのか processing のままか」がどちらのログにも
  //   残らず、status を変えた直後の確認が画面を見るしかなくなる (2026-08-30 に実際そうなった)。
  //   ★★ 「観測不能」と「起きていない」を取り違えないための計器。
  logger.info(`[cc-ack] room=${roomId} status=relayed projects=${projects.join(',')} ttl=${ttlMs}ms`);
  const timer = setTimeout(() => {
    void pushStatus(roomId, 'idle', '').catch(() => {});
  }, ttlMs);
  if (timer.unref) timer.unref(); // ack timer が process を延命しない
}

export {
  extractCcProject,
  extractCcProjects,
  findDroppedCcMentions,
  CC_FANOUT_MAX,
  detectUnroutedAddressHint,
  appendCcEvent,
  shouldSkipCcSender,
  loadSkipSenderIds,
  getClaudeDefaultProject,
  loadAliases,
  reloadAliases,
  getAliasesConfigPath,
  emitCcAck,
  DEFAULT_QUEUE_DIR,
  getCcQueueDir,
};
