/**
 * 見張り: ポーリングして、変わったときだけ業務メモに知らせる (#595)
 *
 * 設計は docs/09。**足したくなったら先に §6「作らないもの」を読むこと。**
 *
 * ★ 構造はルームトリガー (roomTriggerRunner.mts) と同じ: 判定は watchdogDecide (純関数)、
 *   投稿は postAsUser。ここは**繋ぐだけ**。
 * ★★ 状態は持たない。「前回は ⚠ を出したか」は業務メモの自分の投稿 (印つき) から引く (§3.3)。
 *   本体を再起動しても、止まったままなら 2 度は鳴らない。
 * ★★ 見張りが見張られる側と一緒に死なないよう、本体に置く (§4)。
 */
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';
import { assessBackup, readLatestBackupLog, type BackupRead } from './backupLog.mts';
import { postAsUser, type PostAsUserResult, type SenderContext } from './postAsUser.mts';
import {
  decideNotice, judgeBackupLog, judgeHeartbeat, judgeRoomQuiet,
  type LastNotice, type Observation,
} from './watchdogDecide.mts';
import { getHeartbeat, type Heartbeat } from './heartbeats.mts';
import {
  CONFIG_PATH, loadWatchdogs, markFor,
  type HeartbeatWatch, type Notify, type RoomQuietWatch, type Watch, type WatchdogConfig,
} from './watchdogs.mts';

/** 判定の間隔。止まったものに気づくのが最大これだけ遅れる。閾値 (150 分・26 時間) に比べて十分短い */
const POLL_MS = 5 * 60_000;
/**
 * 起動の直後は最初の判定を少し待つ。★ 本体が止まっている間は部品が鼓動を送れないので、
 * 長く止まっていた直後に判定すると「鼓動が来ない」と誤って鳴る (docs/09 §7)。
 * 部品の鼓動は 1 分ごとなので、2 分待てば 1 回は届いている。
 */
const FIRST_RUN_MS = 2 * 60_000;

export interface RunDeps {
  now: Date;
  lastNotice: (w: Watch, notify: Notify) => Promise<LastNotice | null>;
  lastPostAt: (w: RoomQuietWatch) => Promise<Date | null>;
  heartbeatOf: (w: HeartbeatWatch) => Promise<Heartbeat | null>;
  readBackup: (dir: string) => BackupRead;
  resolveSender: (userId: string) => Promise<SenderContext | null>;
  post: (input: { roomId: string; sender: SenderContext; content: string }) => Promise<PostAsUserResult>;
}

export interface RunResult {
  id: string;
  state: Observation['state'] | 'error';
  detail: string;
  posted: 'alert' | 'recover' | null;
  /** 判定や投稿に失敗したときの理由 (= 見張り自身の不具合。業務メモには出さない、§3.4) */
  error?: string;
}

async function observe(w: Watch, deps: RunDeps): Promise<Observation> {
  switch (w.kind) {
    case 'backup_log': return judgeBackupLog(assessBackup(deps.readBackup(w.dir), deps.now));
    case 'room_quiet': return judgeRoomQuiet(w, await deps.lastPostAt(w), deps.now);
    case 'heartbeat': return judgeHeartbeat(w, await deps.heartbeatOf(w), deps.now);
  }
}

/** 1 周ぶん。★ 1 行の失敗が他を止めないよう、行ごとに囲う */
export async function runOnce(config: WatchdogConfig, deps: RunDeps): Promise<RunResult[]> {
  const results: RunResult[] = [];
  let sender: SenderContext | null | undefined;
  for (const w of config.watches) {
    if (!w.enabled) continue;
    try {
      const obs = await observe(w, deps);
      // ★ 稼働時間の外は前回の知らせも引かない (DB を無駄に叩かない)
      if (obs.state === 'skip') { results.push({ id: w.id, state: 'skip', detail: obs.detail, posted: null }); continue; }
      const d = decideNotice(w, obs, await deps.lastNotice(w, config.notify), deps.now);
      if (!d.kind || !d.body) { results.push({ id: w.id, state: obs.state, detail: obs.detail, posted: null }); continue; }

      if (sender === undefined) sender = await deps.resolveSender(config.notify.as_user_id);
      if (!sender) {
        results.push({ id: w.id, state: obs.state, detail: obs.detail, posted: null,
          error: `投稿する人 (as_user_id ${config.notify.as_user_id}) が見つかりません` });
        continue;
      }
      const posted = await deps.post({ roomId: config.notify.room_id, sender, content: d.body });
      results.push(posted.ok
        ? { id: w.id, state: obs.state, detail: obs.detail, posted: d.kind }
        : { id: w.id, state: obs.state, detail: obs.detail, posted: null, error: posted.reason });
    } catch (err) {
      results.push({ id: w.id, state: 'error', detail: '判定中に例外', posted: null,
        error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

// --- 本番の配線 ------------------------------------------------------------

/** ★ 業務メモの自分の投稿 (印つき) のうち最新。1 行目が ⚠ なら「止まっていると知らせ済み」 */
async function lastNoticeFromRoom(w: Watch, notify: Notify): Promise<LastNotice | null> {
  const { rows } = await pool.query<{ content: string; created_at: Date }>(
    `SELECT content, created_at FROM messages
      WHERE room_id = $1 AND sender_id = $2 AND is_deleted = false AND content LIKE $3
      ORDER BY created_at DESC LIMIT 1`,
    [notify.room_id, notify.as_user_id, `%${markFor(w.id)}%`],
  );
  const row = rows[0];
  if (!row) return null;
  return { kind: row.content.startsWith('⚠') ? 'alert' : 'recover', at: row.created_at };
}

async function lastPostAtFromRoom(w: RoomQuietWatch): Promise<Date | null> {
  const { rows } = await pool.query<{ at: Date | null }>(
    `SELECT MAX(created_at) AS at FROM messages
      WHERE room_id = $1 AND sender_id = ANY($2::uuid[]) AND is_deleted = false`,
    [w.room_id, w.from_user_ids],
  );
  return rows[0]?.at ?? null;
}

/** ★ 名前だけでなく送り手でも絞る (別の人が同じ名前で送った鼓動を拾わない) */
function heartbeatOfWatch(w: HeartbeatWatch): Promise<Heartbeat | null> {
  return getHeartbeat(w.from_user_id, w.heartbeat);
}

async function resolveSenderFromDb(userId: string): Promise<SenderContext | null> {
  const { rows } = await pool.query<SenderContext>('SELECT id, display_name, avatar_url FROM users WHERE id = $1', [userId]);
  return rows[0] ?? null;
}

let firstTimer: NodeJS.Timeout | null = null;
let timer: NodeJS.Timeout | null = null;
const lastStates = new Map<string, string>();

async function tick(configPath: string, warned: { signature: string }): Promise<void> {
  const { config, warnings } = loadWatchdogs(configPath);
  // ★ 同じ warn を 5 分ごとに出さない。ただし内容が変わったら必ず出す
  const signature = warnings.join('|');
  if (signature !== warned.signature) {
    for (const w of warnings) logger.warn(`[watchdogs] ${w}`);
    warned.signature = signature;
  }
  if (!config) return;
  const results = await runOnce(config, {
    now: new Date(),
    lastNotice: lastNoticeFromRoom,
    lastPostAt: lastPostAtFromRoom,
    heartbeatOf: heartbeatOfWatch,
    readBackup: readLatestBackupLog,
    resolveSender: resolveSenderFromDb,
    post: postAsUser,
  });
  for (const r of results) {
    const line = `[watchdogs] ${r.id}: ${r.state} — ${r.detail}${r.posted ? ` (業務メモに ${r.posted === 'alert' ? '⚠' : '✅'} を投稿)` : ''}`;
    if (r.error) { logger.warn(`${line} / ★ ${r.error}`); continue; }
    // ★ 5 分ごとに同じ行を出さない。状態が変わったときと投稿したときだけ
    if (r.posted || lastStates.get(r.id) !== r.state) logger.info(line);
    lastStates.set(r.id, r.state);
  }
}

/**
 * ポーリングを開始する。★ 設定ファイルが無くても回る (置いたら次の周から効く = 再起動不要)。
 * ★★ 起動は止めない —— 見張りの設定ミスで本体が上がらない方が高くつく。
 */
export function startWatchdogs(configPath: string = CONFIG_PATH): void {
  if (timer || firstTimer) return;
  const initial = loadWatchdogs(configPath);
  const warned = { signature: '' };
  const n = initial.config?.watches.filter((w) => w.enabled).length ?? 0;
  logger.info(`[watchdogs] ${n} 件を ${POLL_MS / 60_000} 分ごとに見ます${initial.config ? '' : ' (設定ファイルなし)'}`);
  const run = () => { tick(configPath, warned).catch((err) => logger.warn(`[watchdogs] 1 周が失敗しました: ${err instanceof Error ? err.message : String(err)}`)); };
  firstTimer = setTimeout(() => { firstTimer = null; run(); }, FIRST_RUN_MS);
  firstTimer.unref();
  timer = setInterval(run, POLL_MS);
  timer.unref();
}

export function stopWatchdogs(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (timer) clearInterval(timer);
  firstTimer = null;
  timer = null;
  lastStates.clear();
}
