/**
 * cc-queue: Claude Code session ↔ Tealus リアルタイム連携の file beacon writer
 *
 * #213 Phase A: `@cc-{project}` mention を検知したら、`~/.tealus/cc-queue/{project}.jsonl` に payload を 1 行 append する。
 * Claude Code session 側 (と配達役 courier) は当該 file を見て、新着行で起きる。
 *
 * ★ #650 (docs/14、2026-11-23): agent-server の webhook/ccQueue.mts から本体へ写した。
 *   `CC_INTAKE=server` のときだけ本体が受け付ける (ccIntake.mts)。それ以外は今までどおり agent-server が書く。
 *   宛名の読み取り・受け箱の形・切り詰めは agent-server と同じ。変えたのは次の 3 つだけ:
 *   (★ 2026-11-25 改善ループ 108: 宛名の読み取りの純関数は ccAddress.mts に出した。agent-server と同じ中身かをテストが突き合わせる)
 *   - 切り詰めの判定は行数を覚えておく (本体は全員のチャットを配るプロセスなので、毎回ファイル全体を同期で読まない)
 *   - 別名の設定は server/config/cc-aliases.json (`CC_ALIASES_FILE` で差し替え)。旧互換の CLAUDE_DEFAULT_PROJECT は持ってこない (本番で未設定)
 *   - 「届きました」の表示は本体が直接配る (agentStatus.mts。番号も本体で持つ、§5.4)
 *
 * 設計: stateless / convention-based。project 一覧の管理は無し、mention の suffix が
 * そのまま file 名になる。複数 project が並列稼働しても各 jsonl が独立。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../../utils/logger.mts';
import { publish } from './ccSubscribers.mts';
import { statusSeqOf, emitAgentStatus } from '../agentStatus.mts';
import { CC_MENTION_RE, CC_FANOUT_MAX, addressRunCcNames, findDroppedCcMentions, detectUnroutedAddressHint, type UnroutedAddressHint } from './ccAddress.mts';

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


// alias mention 設定ファイルの path 解決 (#263、Level 2)。
// CC_ALIASES_FILE で差し替え可能 (テストは jest.setup.js が一時の道を入れる)。既定は server/config/cc-aliases.json
function getAliasesConfigPath(): string {
  return process.env.CC_ALIASES_FILE || path.join(import.meta.dirname, '..', '..', '..', 'config', 'cc-aliases.json');
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
 * メッセージ content から cc-queue routing 用の project 名を抽出する。
 * - 宛名欄 (行頭から続く mention の並び) に `@cc-{project}` があればその project (#393)
 * - どの行でもよいので**行頭**に `@cc-{project}` があればその project
 * - cc-aliases.json の alias 一覧を順に check、最初に match した alias の project
 * - どれも無ければ null
 *
 * @param content
 * @returns project 名、無ければ null
 */
function extractCcProject(content: string | null | undefined): string | null {
  if (typeof content !== 'string' || content.length === 0) return null;
  // ★ 宛名欄が先。1 行目の宛名は、他の行の行頭 mention より前にある
  const run = addressRunCcNames(content);
  if (run.length > 0) return run[0];
  const ccMatch = content.match(CC_MENTION_RE);
  if (ccMatch) return ccMatch[1];
  const aliases = getAliases();
  for (const alias of aliases) {
    if (alias.regex.test(content)) return alias.project;
  }
  return null;
}

/**
 * 配送先の一覧を返す (#387 同報)。
 *
 * ★ **宛名欄に並べたものだけ**を宛先とする ([[addressRunCcNames]])。`@cc-a @cc-b @cc-c` の形。
 *   それ以外は `extractCcProject()` と同じ 1 宛先に落ちる (alias 経由もここに含む)。
 *   ★ #393 で「並びの前に `@アシスタント` 等が付いていてもよい」に広げた。**連名の扱いは不変**。
 *
 * ★ なぜ「宛名欄」に限るのか —— **測ったから**。cc-queue の全 1323 便で:
 * ```
 *   1 行目の先頭に並べた便          2 件 → 2 件とも本物の同報 (2026-08-21 / 08-23)
 *   1 行目以外の行頭に mention がある便 2 件 → 2 件とも引用・案内表 = 配ったら誤配
 * ```
 *   両者は母集団で完全に排他だった。全体を `/m` で走査する実装にすると、
 *   **拾いたい 2 件は増えず、誤配だけが 2 件増える** (案内表の便は 7 セッションを起こす)。
 *
 * ★ 自己ループ防止 (docs/06 §6.1) もこの限定で保たれる。AI の返信が本文中で
 *   `@cc-*` を引用しても、宛名欄には来ない (並びは mention でない語で途切れるため)。
 *
 * @returns 配送先の配列 (重複排除・出現順・最大 CC_FANOUT_MAX)。宛先が無ければ空配列
 */
function extractCcProjects(content: string | null | undefined): string[] {
  if (typeof content !== 'string' || content.length === 0) return [];
  const names = addressRunCcNames(content);
  if (names.length > 1) return names.slice(0, CC_FANOUT_MAX);
  // 単一宛先 (従来経路)。alias もここで解決される
  const single = extractCcProject(content);
  return single ? [single] : [];
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
 * ★ #650 ファイルごとの行数の覚え。本体は全員のチャットを配るプロセスなので、書くたびに全体を読まない (docs/14 §5.1)。
 *   最初の 1 回だけ数え、あとは足した分を数える。切り詰めたら残した行数にする。
 *   外から書き換えられても (人が手で消した等)、ずれるのは「切り詰めの時期」だけで、切り詰めるときに読み直して数え直す
 */
const lineCounts = new Map<string, number>();

function countLines(filePath: string): number {
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l !== '').length;
  } catch {
    return 0;
  }
}

/** テスト用: 行数の覚えを捨てる */
function _resetLineCounts(): void {
  lineCounts.clear();
}

/**
 * jsonl が上限を超えていたら末尾 keep 行だけ残す。
 * temp file に書いて rename する = 読み手 (tail -F / stream) が途中の状態を見ない。
 * 呼ぶのは 1 行足した直後 (足した分を数える)
 */
function trimIfNeeded(filePath: string): void {
  const max = ccQueueMaxLines();
  const known = lineCounts.get(filePath);
  const count = known === undefined ? countLines(filePath) : known + 1;
  lineCounts.set(filePath, count);
  if (count <= max) return;
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;   // append 直後なので通常あり得ないが、trim の失敗で append を壊さない
  }
  const lines = content.split('\n').filter((l) => l !== '');
  lineCounts.set(filePath, lines.length);
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
 * 表示は best-effort: 失敗しても beacon は既に積まれているので握りつぶす。
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
  /**
   * 部屋に表示を出す。★ #650 本体では既定で直接配る (agentStatus.mts の emitAgentStatus)。
   *   agent-server はアシスタントの口座で POST /bot/status を叩いていた (アシスタントがいる部屋でしか出なかった)
   */
  pushStatus?: (roomId: string, status: string, message: string, label: string) => void;
  /** 表示時間 (ms)。既定 CC_ACK_TTL_MS。 */
  ttlMs?: number;
  /** #542 部屋の表示の番号 (既定 agentStatus.mts)。テストで差し替える */
  statusSeq?: (roomId: string) => number;
}

/**
 * 本体からの「届きました」の表示。★ 名前は `cc:<班>` (画面の宛先候補と同じ形)。
 *   画面は `${display_name}: ${message}` と出すので、表示名に宛先を入れて文面には入れない (「cc-x: cc-x に届きました」と二重にしない)
 */
function defaultPushStatus(roomId: string, status: string, message: string, label: string): void {
  emitAgentStatus(roomId, { agent_id: `cc:${label}`, status, message, display_name: label });
}

function emitCcAck({ projects, roomId, pushStatus = defaultPushStatus, ttlMs = CC_ACK_TTL_MS, statusSeq = statusSeqOf }: CcAckDeps): void {
  const label = projects.map((p) => `cc-${p}`).join(' / ');
  // ★ 'processing' ではなく 'relayed'。これは「このボットが処理中」ではなく
  //   「**別セッションへ中継した**」の意味で、止められる処理が無い。
  //   'processing' のままだと client が中断ボタンを出し、押しても何も起きない
  //   (2026-08-30 実測。#399 で表示条件を広げたときに巻き込んだ)。
  //   ★★ client 側の対は `client/src/utils/agentStatus.ts` の RELAYED_STATUS。片方だけ変えると壊れる。
  try { pushStatus(roomId, 'relayed', '届きました。応答をお待ちください…', label); } catch { /* 表示は best-effort */ }
  // ★ 1 行残す。これが無いと「relayed で出たのか processing のままか」がどちらのログにも
  //   残らず、status を変えた直後の確認が画面を見るしかなくなる (2026-08-30 に実際そうなった)。
  //   ★★ 「観測不能」と「起きていない」を取り違えないための計器。
  logger.info(`[cc-ack] room=${roomId} status=relayed projects=${projects.join(',')} ttl=${ttlMs}ms`);
  // ★ #542 自分の後に別の表示 (アシスタントの「考え中」など) が出ていたら消さない。
  //   以前は無条件に idle を出し、同じ便で動いたアシスタントの「考え中」を 5 秒で消していた。
  //   ★ #650 番号は本体が持つ (表示はすべて本体を通る)。画面は誰の idle でも消すので、ここで止めるしかない
  const seqAfterAck = statusSeq(roomId);
  const timer = setTimeout(() => {
    if (statusSeq(roomId) !== seqAfterAck) return;
    try { pushStatus(roomId, 'idle', '', label); } catch { /* noop */ }
  }, ttlMs);
  if (timer.unref) timer.unref(); // ack timer が process を延命しない
}

export type { UnroutedAddressHint };

export {
  extractCcProject,
  extractCcProjects,
  findDroppedCcMentions,
  CC_FANOUT_MAX,
  detectUnroutedAddressHint,
  appendCcEvent,
  shouldSkipCcSender,
  loadSkipSenderIds,
  loadAliases,
  reloadAliases,
  getAliasesConfigPath,
  emitCcAck,
  DEFAULT_QUEUE_DIR,
  getCcQueueDir,
  _resetLineCounts,
};
