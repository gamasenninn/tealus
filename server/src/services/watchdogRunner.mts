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
import fs from 'node:fs';
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';
import { assessBackup, readLatestBackupLog, type BackupRead } from './backupLog.mts';
import { postAsUser, type PostAsUserResult, type SenderContext } from './postAsUser.mts';
import {
  decideNotice, judgeBackupLog, judgeDiskFree, judgeHeartbeat, judgePushReach, judgeRoomQuiet,
  type DiskRead, type LastNotice, type Observation, type PushTarget,
} from './watchdogDecide.mts';
import { getHeartbeat, type Heartbeat } from './heartbeats.mts';
import {
  CONFIG_PATH, loadWatchdogs, markFor,
  type HeartbeatWatch, type Notify, type PushReachWatch, type RoomQuietWatch, type Watch, type WatchdogConfig,
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
  /** ★ id で印を引く。push_reach は人ごとの id (`<行の id>:<user_id>`) */
  lastNotice: (w: Pick<Watch, 'id'>, notify: Notify) => Promise<LastNotice | null>;
  lastPostAt: (w: RoomQuietWatch) => Promise<Date | null>;
  heartbeatOf: (w: HeartbeatWatch) => Promise<Heartbeat | null>;
  readBackup: (dir: string) => Promise<BackupRead>;
  pushTargets: (w: PushReachWatch) => Promise<PushTarget[]>;
  diskFree: (path: string) => Promise<DiskRead>;
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

/** 知らせの単位。ふつうは設定の 1 行、push_reach は 1 人 (id は `<行の id>:<user_id>`) */
interface Unit { id: string; name: string; kind?: Watch['kind']; observe: () => Promise<Observation> }

async function unitsOf(w: Watch, deps: RunDeps): Promise<Unit[]> {
  switch (w.kind) {
    case 'backup_log': return [{ id: w.id, name: w.name, observe: async () => judgeBackupLog(assessBackup(await deps.readBackup(w.dir), deps.now)) }];
    case 'room_quiet': return [{ id: w.id, name: w.name, observe: async () => judgeRoomQuiet(w, await deps.lastPostAt(w), deps.now) }];
    case 'heartbeat': return [{ id: w.id, name: w.name, observe: async () => judgeHeartbeat(w, await deps.heartbeatOf(w), deps.now) }];
    case 'disk_free': return [{ id: w.id, name: w.name, kind: w.kind, observe: async () => judgeDiskFree(w, await deps.diskFree(w.path)) }];
    case 'push_reach': {
      // ★ 人ごとに開く。状態も人ごとの印から引くので、A が ⚠ のままでも B の ⚠ は出る (docs/09 §3.6)
      const exclude = new Set(w.exclude_user_ids);
      return (await deps.pushTargets(w))
        .filter((t) => !exclude.has(t.user_id))
        .map((t) => ({
          id: `${w.id}:${t.user_id}`,
          name: `${t.display_name} さんへの${w.name}`,
          observe: async () => judgePushReach(t, w.active_within_days, deps.now),
        }));
    }
  }
}

/** 1 周ぶん。★ 1 行の失敗が他を止めないよう、行ごとに (push_reach は人ごとにも) 囲う */
export async function runOnce(config: WatchdogConfig, deps: RunDeps): Promise<RunResult[]> {
  const results: RunResult[] = [];
  let sender: SenderContext | null | undefined;
  for (const w of config.watches) {
    if (!w.enabled) continue;
    let units: Unit[];
    try {
      units = await unitsOf(w, deps);
    } catch (err) {
      results.push({ id: w.id, state: 'error', detail: '対象の取得に失敗', posted: null,
        error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    for (const u of units) {
      try {
        const obs = await u.observe();
        // ★ 稼働時間の外 (使っていない人) は前回の知らせも引かない (DB を無駄に叩かない)
        if (obs.state === 'skip') { results.push({ id: u.id, state: 'skip', detail: obs.detail, posted: null }); continue; }
        const d = decideNotice(u, obs, await deps.lastNotice(u, config.notify), deps.now);
        if (!d.kind || !d.body) { results.push({ id: u.id, state: obs.state, detail: obs.detail, posted: null }); continue; }

        if (sender === undefined) sender = await deps.resolveSender(config.notify.as_user_id);
        if (!sender) {
          results.push({ id: u.id, state: obs.state, detail: obs.detail, posted: null,
            error: `投稿する人 (as_user_id ${config.notify.as_user_id}) が見つかりません` });
          continue;
        }
        const posted = await deps.post({ roomId: config.notify.room_id, sender, content: d.body });
        results.push(posted.ok
          ? { id: u.id, state: obs.state, detail: obs.detail, posted: d.kind }
          : { id: u.id, state: obs.state, detail: obs.detail, posted: null, error: posted.reason });
      } catch (err) {
        results.push({ id: u.id, state: 'error', detail: '判定中に例外', posted: null,
          error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return results;
}

// --- 本番の配線 ------------------------------------------------------------

/** ★ 業務メモの自分の投稿 (印つき) のうち最新。1 行目が ⚠ なら「止まっていると知らせ済み」 */
async function lastNoticeFromRoom(w: Pick<Watch, 'id'>, notify: Notify): Promise<LastNotice | null> {
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

/**
 * push_reach の対象 (docs/09 §3.6): 有効で機械でない利用者のうち、部屋に 1 つ以上入っている人。
 * ★ 「最近使っている」は既読の記録で見る (users.last_seen_at はどこからも更新されていない)
 */
async function pushTargetsFromDb(): Promise<PushTarget[]> {
  const { rows } = await pool.query<PushTarget>(
    `SELECT u.id AS user_id, u.display_name,
            (SELECT COUNT(*)::int FROM push_subscriptions p WHERE p.user_id = u.id AND p.is_active) AS active_subs,
            (SELECT COUNT(*)::int FROM push_subscriptions p WHERE p.user_id = u.id) AS total_subs,
            (SELECT MAX(p.updated_at) FROM push_subscriptions p
              WHERE p.user_id = u.id AND NOT p.is_active
                -- ★ 無効にした時刻は 10-16 から updated_at に残す (push.mts)。それ以前の行の updated_at は
                --   登録 (登録し直し) の時刻で、無効になった時刻ではない (本番の実例: 10-13 に無効 → 10-05 と出た)。
                --   ★ 時刻が分からない行は数えない = 本文に時刻を書かない
                AND p.updated_at >= TIMESTAMPTZ '2026-10-16 05:00:00+00') AS last_lost_at,
            (SELECT MAX(c.last_read_at) FROM room_read_cursors c WHERE c.user_id = u.id) AS last_read_at
       FROM users u
      WHERE u.is_active AND NOT u.is_bot
        AND EXISTS (SELECT 1 FROM room_members m WHERE m.user_id = u.id)
      ORDER BY u.created_at`,
  );
  return rows;
}

async function diskFreeOf(p: string): Promise<DiskRead> {
  try {
    const st = await fs.promises.statfs(p);
    return { freeBytes: st.bavail * st.bsize };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function resolveSenderFromDb(userId: string): Promise<SenderContext | null> {
  const { rows } = await pool.query<SenderContext>('SELECT id, display_name, avatar_url FROM users WHERE id = $1', [userId]);
  return rows[0] ?? null;
}

let firstTimer: NodeJS.Timeout | null = null;
let timer: NodeJS.Timeout | null = null;
const lastStates = new Map<string, string>();

/**
 * 見張りの結果の 1 行 (改善ループ 16 回目)。★ 止まった (down) は warn (以前は info で、気づくべきものが埋もれた)。
 * ★ 説明の改行は「 / 」に (業務メモの文面は改行のまま。ログだけ 1 行にする。2 行目が時刻も [tag] も無い行になっていた)
 */
export function watchdogLogLine(r: Pick<RunResult, 'id' | 'state' | 'detail' | 'posted'>): { level: 'info' | 'warn'; line: string } {
  const detail = r.detail.replace(/\s*\n\s*/g, ' / ');
  const line = `[watchdogs] ${r.id}: ${r.state} — ${detail}${r.posted ? ` (業務メモに ${r.posted === 'alert' ? '⚠' : '✅'} を投稿)` : ''}`;
  return { level: r.state === 'down' ? 'warn' : 'info', line };
}

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
    pushTargets: pushTargetsFromDb,
    diskFree: diskFreeOf,
    resolveSender: resolveSenderFromDb,
    post: postAsUser,
  });
  for (const r of results) {
    const { level, line } = watchdogLogLine(r);
    if (r.error) { logger.warn(`${line} / ★ ${r.error}`); continue; }
    // ★ 5 分ごとに同じ行を出さない。状態が変わったときと投稿したときだけ
    if (r.posted || lastStates.get(r.id) !== r.state) logger[level](line);
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
