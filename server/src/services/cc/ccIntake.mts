/**
 * CC ブリッジの受け付け (#650、docs/14、2026-11-23)。`@cc-班` を見つけて班の受け箱に 1 行入れる。
 *
 * ★ `CC_INTAKE=server` のときだけ動く。未設定なら今までどおり agent-server が webhook で受け付ける (§6・§7)
 * ★ 入口は「AI へ知らせる」(docs/07 の ③) と同じ場所・同じ on/off (postEffects の announcePost)。webhook (fireWebhooks) には乗せない
 *   (webhook の登録が 0 行だと何もせず戻るので、「本体だけで CC ブリッジが動く」にならない、§4)
 * ★ 1 行の形は agent-server と同じ (docs/12 §4.1)。編集の便も新規と同じ形にそろえる (§5.2)
 * ★ 判定の順と理由は agent-server の webhook/handler.mts (routeCcEvent・handleMessageCreated・handleMessageUpdated) から写した
 */
import fs from 'node:fs';
import os from 'node:os';
import { pool } from '../../db/pool.mts';
import { logger } from '../../utils/logger.mts';
import { errorText } from '../../utils/logFormat.mts';
import {
  extractCcProjects, findDroppedCcMentions, detectUnroutedAddressHint, appendCcEvent, loadSkipSenderIds,
  emitCcAck, getCcQueueDir, getAliasesConfigPath, type UnroutedAddressHint,
} from './ccQueue.mts';
import { claimWriter } from './ccWriter.mts';

/** 本体が受け付けるか。★ 呼ぶたびに読む (テストが env を後から変える) */
export function ccIntakeEnabled(): boolean {
  return process.env.CC_INTAKE === 'server';
}

/**
 * 班を起こさない送り主。`CC_SKIP_SENDER_IDS` (CSV) + アシスタントの口座 (起動時に agent-server へ聞いて足す)。
 * ★ 決定 (2026-11-21、docs/14 §11 の 1): アシスタントは班を起こせない。将来の許可リスト制を足せるよう、送り主で捨てる判定はここ 1 か所
 * ★ bot を一律に外さない (MCP の口座で投稿する班どうしの起こし合いは使われている)
 */
const extraSkipIds = new Set<string>();
export function addCcSkipSenderId(id: string): void {
  if (id) extraSkipIds.add(id);
}
export function _resetCcSkipSenderIds(): void {
  extraSkipIds.clear();
}
export function isCcSkippedSender(senderId: string | null | undefined): boolean {
  if (!senderId) return false;
  return extraSkipIds.has(senderId) || loadSkipSenderIds().has(senderId);
}

/**
 * 起動時に 1 回、agent-server にアシスタントの口座を聞いて送り主の除外に足す (入れ忘れ止め、§4)。
 * 聞けなければ設定の値だけ (アシスタントを使わない採用者は空のまま)
 */
export async function learnAssistantSender(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    // ★ /agent/identity はログインだけを見る (署名の検証のみ)。本体は gatewayBye と同じく自分で鍵を作って聞く
    const res = await fetchImpl(`${baseUrl}/agent/identity`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) } as RequestInit);
    if (!res.ok) return null;
    const body = await res.json() as { user_id?: unknown; id?: unknown };
    const id = typeof body.user_id === 'string' ? body.user_id : typeof body.id === 'string' ? body.id : null;
    if (id) {
      addCcSkipSenderId(id);
      logger.info(`[cc-queue] アシスタントの口座 ${id} からの @cc- は班を起こしません (docs/14 §11 の 1)`);
    }
    return id;
  } catch (err) {
    // ★ debug。agent-server を使わない採用者では聞き続けても答えが無く、5 分ごとに行が増える (呼ぶ側が 10 回目に 1 回だけ言う)
    logger.debug(`[cc-queue] アシスタントの口座を聞けませんでした: ${errorText(err)}`);
    return null;
  }
}

interface SenderInfo { id: string; display_name: string; role: string }

async function senderInfo(id: string): Promise<SenderInfo | null> {
  const r = await pool.query<SenderInfo>('SELECT id, display_name, role FROM users WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

/** 部屋の名前。1 対 1 で名前が無ければ「A ↔ B」(fireWebhooks と同じ組み立て、webhook.mts) */
async function roomName(roomId: string): Promise<string | null> {
  const r = await pool.query<{ name: string | null; type: string }>('SELECT name, type FROM rooms WHERE id = $1', [roomId]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.name || row.type !== 'direct') return row.name;
  const m = await pool.query<{ display_name: string }>(
    'SELECT u.display_name FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = $1', [roomId]);
  return m.rows.length > 0 ? m.rows.map((x) => x.display_name).join(' ↔ ') : null;
}

export interface CcSourceMessage {
  id: string;
  type: string;
  content: string | null;
  created_at?: string;
  sender: { id: string; display_name?: string };
}

/**
 * 受け箱に積む (新規・編集の共通)。
 * @param targets 実際に積む先
 * @param recipients 便に載せる宛先一覧 (編集では targets と違う。既に届いた班には積み直さないが、受け手には全体を見せる)
 * @returns 積めた班
 */
async function routeCcEvent(roomId: string, message: CcSourceMessage, targets: string[], recipients: string[], tag = ''): Promise<{ delivered: string[]; sender: SenderInfo | null }> {
  // ★ 送り主の権限は DB で引く。引けなければ配らない (agent-server は「載っていなければ配る」だった、§4)
  const sender = await senderInfo(message.sender.id);
  if (!sender) {
    logger.warn(`${tag}[cc-queue] 送り主を引けないため配送していません: @cc-${targets.join(' @cc-')} room=${roomId} sender=${message.sender.id} id=${message.id}`);
    return { delivered: [], sender: null };
  }
  const name = await roomName(roomId);
  // ★ #491 ゲストの便は配送しない。cc の先は社内の作業用セッション = 部屋の外 (#282 の原則)
  if (sender.role === 'guest') {
    logger.info(`${tag}[cc-queue] ゲストの便のため配送していません: @cc-${targets.join(' @cc-')} room=${name || roomId} sender=${sender.display_name}`);
    return { delivered: [], sender };
  }
  // ★ §6 受け箱を書くのは 1 プロセス。書くたびに札を見る
  const dir = getCcQueueDir();
  const claim = claimWriter(dir);
  if (!claim.ok) {
    logger.error(`${tag}[cc-queue] ★ 受け箱の持ち主が別のプロセス (${claim.holder.process} pid=${claim.holder.pid}) のため書いていません: `
      + `@cc-${targets.join(' @cc-')} id=${message.id} room=${name || roomId}。CC_INTAKE を両方で同じ値にしてください (docs/14 §6)`);
    return { delivered: [], sender };
  }
  const payload = {
    id: message.id,
    room_id: roomId,
    room_name: name,
    sender: { id: sender.id, display_name: message.sender.display_name ?? sender.display_name, role: sender.role },
    content: message.content,
    type: message.type,
    created_at: message.created_at || new Date().toISOString(),
    // #387 受け手が「これは N 班に配られた」と分かる形。無いと 2 班が同じ作業を並行する
    recipients,
  };
  const delivered: string[] = [];
  for (const project of targets) {
    try {
      const filePath = appendCcEvent(project, payload, dir);
      delivered.push(project);
      logger.info(`${tag}[cc-queue] Routed @cc-${project} → ${filePath}`);
    } catch (err) {
      logger.error(`${tag}[cc-queue] Append failed (@cc-${project}) id=${message.id}: ${errorText(err)}`);
    }
  }
  // #335 受付エコー。★ #650 本体から直接出すので、アシスタントのいない部屋でも出る
  if (delivered.length > 0) emitCcAck({ projects: delivered, roomId });
  return { delivered, sender };
}

const UNROUTED_REMEDY: Record<Exclude<UnroutedAddressHint, null>, string> = {
  'decorated-address': '。★ 宛名は 1 行目の行頭に飾りを付けずに素で書いてください (`**@cc-x**` は起こしません)',
  'malformed-cc-mention': '。★ project 名は小文字・英数字とハイフンだけです',
  'team-arrow': '。★ 起こしたい相手がいるなら 1 行目の行頭に @cc-{project} を書いてください',
};

/**
 * 新しい投稿 (announcePost の ③ が on のとき)。★ 待たずに投げてよい (失敗は中で記録する)
 */
export async function ccIntakeCreated(roomId: string, message: CcSourceMessage): Promise<string[]> {
  if (!ccIntakeEnabled()) return [];
  try {
    const projects = extractCcProjects(message.content);
    if (projects.length === 0) {
      // #359 (a) 宛先を書いたつもりで配送されなかった便を見えるようにする (精度優先なので info)
      const hint = detectUnroutedAddressHint(message.content);
      if (hint) {
        const head = (message.content || '').split('\n').find((l) => l.trim().length > 0) || '';
        logger.info(`[cc-queue] 宛先未解決のため配送していません (${hint}): room=${roomId} sender=${message.sender.display_name || message.sender.id} head="${head.slice(0, 60)}"` + UNROUTED_REMEDY[hint]);
      }
      return [];
    }
    if (isCcSkippedSender(message.sender.id)) {
      logger.debug(`[cc-queue] Skipped sender ${message.sender.id} for @cc-${projects.join(' @cc-')}`);
      return [];
    }
    const { delivered, sender } = await routeCcEvent(roomId, message, projects, projects);
    // #386 1 行目の先頭以外の宛先は配らない。黙って捨てずに warn (ゲスト・書けなかったときは理由が違うので出さない)
    if (sender && sender.role !== 'guest' && delivered.length > 0) {
      const dropped = findDroppedCcMentions(message.content, delivered);
      if (dropped.length > 0) {
        logger.warn(`[cc-queue] 1 行目の先頭以外にある宛先には配送していません: 配送先=${delivered.join(',')} 未配送=${dropped.join(',')} room=${roomId} sender=${message.sender.id}。同報するときは 1 行目の先頭に @cc-a @cc-b と並べてください`);
      }
    }
    return delivered;
  } catch (err) {
    logger.error(`[cc-queue] 受け付けに失敗しました id=${message.id}: ${errorText(err)}`);
    return [];
  }
}

/**
 * 編集 (#338 の救済)。編集者 = 投稿者で、宛先が**新しく増えた**班だけに積む (既に届いた班を 2 回起こさない)
 */
export async function ccIntakeUpdated(a: { roomId: string; messageId: string; content: string; previousContent: string | null; senderId: string; editorId: string }): Promise<string[]> {
  if (!ccIntakeEnabled()) return [];
  try {
    if (a.senderId !== a.editorId) return [];
    if (isCcSkippedSender(a.senderId)) return [];
    const now = extractCcProjects(a.content);
    const prev = new Set(extractCcProjects(a.previousContent));
    const added = now.filter((p) => !prev.has(p));
    if (added.length === 0) return [];
    // ★ 新規と同じ形にそろえる (agent-server の編集の便は type・created_at・表示名が欠けていた、§5.2)
    const r = await pool.query<{ type: string; created_at: Date }>('SELECT type, created_at FROM messages WHERE id = $1', [a.messageId]);
    const row = r.rows[0];
    const { delivered } = await routeCcEvent(a.roomId, {
      id: a.messageId, type: row?.type ?? 'text', content: a.content,
      created_at: row?.created_at ? new Date(row.created_at).toISOString() : undefined,
      sender: { id: a.senderId },
    }, added, now, '[edit-trigger]');
    return delivered;
  } catch (err) {
    logger.error(`[edit-trigger][cc-queue] 受け付けに失敗しました id=${a.messageId}: ${errorText(err)}`);
    return [];
  }
}

/**
 * ★ 版ずれの見張り (docs/14 §6、#650 の監査 2)。古い agent-server は札も CC_INTAKE も知らないので、本体だけ切り替えると両方が書く。
 *   agent-server の /cc-queue/pending を 1 回叩く: 410 なら受け付けをやめている (正しい)。それ以外の応答なら、まだ受け付けている
 *   (本体の鍵は agent-server の利用者ではないので、受け付けている側は 401 などを返す)。つながらなければ分からない (agent-server が無い)
 */
export async function checkAgentIntake(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): Promise<'stopped' | 'still-taking' | 'unreachable'> {
  try {
    const res = await fetchImpl(`${baseUrl}/cc-queue/pending?project=tealus`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) } as RequestInit);
    if (res.status === 410) return 'stopped';
    logger.warn(`[cc-queue] ★ agent-server がまだ CC ブリッジを受け付けているようです (/cc-queue/pending が ${res.status})。`
      + 'agent-server の .env にも CC_INTAKE=server を書いて、同じ版で起こし直してください。このままだと両方が受け箱に書きます (docs/14 §6)');
    return 'still-taking';
  } catch {
    return 'unreachable';
  }
}

/**
 * ★ 別名の設定を本体へ写し忘れていないか (docs/14 §7、#650 の監査 7)。本体の設定が無く、agent-server の設定に別名があれば warn
 */
export function warnIfAliasesNotCarried(agentAliasesPath: string): void {
  if (process.env.CC_ALIASES_FILE) return;
  const mine = getAliasesConfigPath();
  if (fs.existsSync(mine)) return;
  try {
    const a = JSON.parse(fs.readFileSync(agentAliasesPath, 'utf8')) as { aliases?: unknown[] };
    if (Array.isArray(a.aliases) && a.aliases.length > 0) {
      logger.warn(`[cc-aliases] ★ 別名の設定が本体にありません (${mine})。agent-server の ${agentAliasesPath} に ${a.aliases.length} 件あります。写してください (docs/14 §7)`);
    }
  } catch { /* agent-server の設定も無い = 別名を使っていない */ }
}

/** 起動時の 1 行 (どちらが受け付けているかをログで分かるように) */
export function describeCcIntake(): string {
  return ccIntakeEnabled()
    ? `[cc-queue] CC ブリッジの受け付けは本体 (CC_INTAKE=server)。受け箱 ${getCcQueueDir()} host=${os.hostname()}`
    : '[cc-queue] CC ブリッジの受け付けは agent-server (CC_INTAKE 未設定)';
}
