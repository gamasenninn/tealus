/**
 * ルームトリガー: ポーリングして撃つ (#382 第 1 段)
 *
 * 設計は docs/06。**拡張を思いつく前に §9「作らないもの」を読むこと。**
 *
 * ★ 構造: 共通のループ 1 本 (§3)。判定は roomTriggerDecide (純関数)、
 *   投稿は postAsUser (bot push と同じ 4 つ)。ここは **繋ぐだけ**。
 *
 * ★★ 検知は messages テーブルを見る (§2.5)。webhook は 4 経路にしか付いておらず、
 *   朝礼の動画も出品写真の画像もその 4 つに入っていない。経路にフックを足す案は
 *   このコードベースが既に 3 回繰り返している失敗の再生産になる (#383)。
 *
 * ★★★ 「前回撃った時刻」は自分の投稿から引く (§3.1.1)。状態ファイルも状態テーブルも作らない。
 */
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';
import { decide } from './roomTriggerDecide.mts';
import { postAsUser, type PostAsUserResult, type SenderContext } from './postAsUser.mts';
import { buildBody, CONFIG_PATH, loadTriggers, markFor, type RoomTrigger } from './roomTriggers.mts';

/** 判定の間隔。immediate が最大これだけ遅れるが、いま人が打っているのは動画と同じ秒〜数分後 (§3) */
const POLL_MS = 10_000;
/** 同じ理由が続いていても、これだけ経ったら 1 行出す (生きていることを沈黙で表さない) */
const HEARTBEAT_MS = 3_600_000;

export interface RunDeps {
  now: Date;
  /** ★ 設定ファイルの mtime = 有効にした時刻。未発火のトリガーの起点 (docs/06 §3.1.2) */
  bootstrapAt?: Date | null;
  lastFiredAt: (t: RoomTrigger) => Promise<Date | null>;
  latestMatchAt: (t: RoomTrigger) => Promise<Date | null>;
  resolveSender: (t: RoomTrigger) => Promise<SenderContext | null>;
  post: (input: { roomId: string; sender: SenderContext; content: string }) => Promise<PostAsUserResult>;
}

export interface RunResult {
  id: string;
  fired: boolean;
  reason: string;
  /** 撃とうとして駄目だったときの理由。判定で撃たない場合は undefined */
  error?: string;
}

/** 1 周ぶん。★ 1 件の失敗が他を止めないよう、トリガーごとに囲う */
export async function runOnce(triggers: RoomTrigger[], deps: RunDeps): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const t of triggers) {
    try {
      // ★ 無効な行で毎周 DB を叩かない。判定だけ先に済ませる
      if (!t.enabled) {
        results.push({ id: t.id, ...pick(decide(t, {
          now: deps.now, lastFiredAt: null, latestMatchAt: null, bootstrapAt: deps.bootstrapAt ?? null,
        })) });
        continue;
      }

      const [lastFiredAt, latestMatchAt] = await Promise.all([deps.lastFiredAt(t), deps.latestMatchAt(t)]);
      const d = decide(t, { now: deps.now, lastFiredAt, latestMatchAt, bootstrapAt: deps.bootstrapAt ?? null });
      if (!d.fire) {
        results.push({ id: t.id, fired: false, reason: d.reason });
        continue;
      }

      const sender = await deps.resolveSender(t);
      if (!sender) {
        results.push({ id: t.id, fired: false, reason: d.reason, error: `as_user_id ${t.as_user_id} が見つかりません` });
        continue;
      }

      const posted = await deps.post({ roomId: t.room_id, sender, content: buildBody(t) });
      results.push(posted.ok
        ? { id: t.id, fired: true, reason: d.reason }
        : { id: t.id, fired: false, reason: d.reason, error: posted.reason });
    } catch (err) {
      results.push({
        id: t.id, fired: false, reason: '判定中に例外',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

function pick(d: { fire: boolean; reason: string }): { fired: boolean; reason: string } {
  return { fired: d.fire, reason: d.reason };
}

export interface ReportState { reason: string; at: Date }

/**
 * この結果を info で出すか。
 *
 * ★ 10 秒ごとに「投稿なし」を出すとログが埋まり、埋もれた計器は無いのと同じ。
 *   かといって黙ると「動いていない」と区別できない (docs/06 §6) ——
 *   **変化したときと、1 時間に 1 回**、という折衷にする。
 */
export function shouldReport(
  result: { fired: boolean; reason: string },
  prev: ReportState | undefined,
  now: Date,
): boolean {
  if (result.fired) return true;
  if (!prev) return true;
  if (prev.reason !== result.reason) return true;
  return now.getTime() - prev.at.getTime() >= HEARTBEAT_MS;
}

// --- 本番の配線 ------------------------------------------------------------

/** ★ 自分が最後に投稿した時刻。印 (§10) を検索キーにする (§3.1.1) */
async function lastFiredAtFromRoom(t: RoomTrigger): Promise<Date | null> {
  const { rows } = await pool.query<{ at: Date | null }>(
    `SELECT MAX(created_at) AS at FROM messages
      WHERE room_id = $1 AND sender_id = $2 AND is_deleted = false AND content LIKE $3`,
    [t.room_id, t.as_user_id, `%${markFor(t.id)}%`],
  );
  return rows[0]?.at ?? null;
}

/**
 * 該当種別の直近投稿。★ 本文は見ない (§6: 条件は種別のみ)
 *
 * ★★ **エージェント (users.is_bot) の投稿は数えない** (#433)。
 *   `#382` は外せない条件の 1 つ目に「エージェントの投稿では発火しない
 *   (ループが構造的に不可能になる)」と書いているが、**実装は sender を見ていなかった**。
 *   成り立っていたのは **設定が `video` だけで、エージェントは text しか投げないから**で、
 *   構造ではなく偶然だった。
 *
 * ★★★ 第 2 段 (出品写真 = `image`) を入れると崩れる —— エージェントには画像を投稿する道具が
 *   ある (`generate_and_send_image` / `send_image`)。AI が画像を 1 枚出すとトリガーが撃ち、
 *   その投稿がまた AI を起こす。**閉じたはずのループが開く。**
 *
 * ★ 入れる前に測った (2026-09-14): 本番のトリガー 2 ルームで、直近 60 日の video / image は
 *   **全部人間の投稿** (bot 0 件)。→ **今の挙動は 1 つも変わらない。**
 *
 * ★★ 既知の限界: 「材料そのものを bot が供給するルーム」ではこの除外が邪魔になる
 *   (例: 通話履歴は 通話履歴ボット が file を投げる)。★★★ **今はそういう every/immediate の
 *   トリガーが 1 件も無いので、設定を増やさない。** 必要になったときに、
 *   そのトリガーだけ除外を外せる形を足すこと (★ 先回りして設定を作らない)。
 */
export async function latestMatchAtFromRoom(t: RoomTrigger): Promise<Date | null> {
  if (t.types.length === 0) return null;

  // ★★★★ #433 (2026-09-17): from_user_ids があれば **その送信者だけ**が材料。
  //   ★ `is_bot` は見ない —— LINE Bridge は bot だが **材料の供給元**だから
  //     (★★ この節が予告していた「必要になったときに、そのトリガーだけ除外を外せる形」がこれ)。
  //   ★★★ 許可リストにエージェントを入れなければ、その返信は最初から材料でない
  //     = ★ ループが開かない。だから `types` に `text` を許してよい (docs/06 §6.1.1)。
  if (t.from_user_ids && t.from_user_ids.length > 0) {
    const { rows } = await pool.query<{ at: Date | null }>(
      `SELECT MAX(m.created_at) AS at FROM messages m
        WHERE m.room_id = $1 AND m.is_deleted = false AND m.type = ANY($2::text[])
          AND m.sender_id = ANY($3::uuid[])`,
      [t.room_id, t.types, t.from_user_ids],
    );
    return rows[0]?.at ?? null;
  }

  const { rows } = await pool.query<{ at: Date | null }>(
    `SELECT MAX(m.created_at) AS at FROM messages m
       JOIN users u ON u.id = m.sender_id
      WHERE m.room_id = $1 AND m.is_deleted = false AND m.type = ANY($2::text[])
        AND u.is_bot = false`,
    [t.room_id, t.types],
  );
  return rows[0]?.at ?? null;
}

async function resolveSenderFromDb(t: RoomTrigger): Promise<SenderContext | null> {
  const { rows } = await pool.query<{ id: string; display_name: string; avatar_url: string | null }>(
    'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
    [t.as_user_id],
  );
  return rows[0] ?? null;
}

/** 起動時にルームの実在と名前を照合する (§4.1)。壊れてはいないが、設定が古い合図 */
async function checkRooms(triggers: RoomTrigger[]): Promise<void> {
  for (const t of triggers) {
    const { rows } = await pool.query<{ name: string | null }>('SELECT name FROM rooms WHERE id = $1', [t.room_id]);
    if (rows.length === 0) {
      logger.warn(`[room-triggers] ${t.id}: room_id ${t.room_id} が存在しません (このトリガーは撃てません)`);
      continue;
    }
    if (t.room && rows[0].name && rows[0].name !== t.room) {
      logger.warn(`[room-triggers] ${t.id}: 設定の room 名 "${t.room}" が現在の "${rows[0].name}" と違います`);
    }
  }
}

let timer: NodeJS.Timeout | null = null;
const reported = new Map<string, ReportState>();

/**
 * ポーリングを開始する。
 *
 * ★ 設定は毎周読み直す = 再起動不要 (§4、前例は line-group-mappings.json)。
 * ★★ 設定ファイルが無ければ何もしない。**起動は止めない** ——
 *   トリガーの設定ミスで本体が上がらない方が高くつく。
 */
export function startRoomTriggers(configPath: string = CONFIG_PATH): void {
  // ★ 二重起動しない。呼び直しても timer は 1 本
  if (timer) return;

  const initial = loadTriggers(configPath);
  for (const w of initial.warnings) logger.warn(`[room-triggers] ${w}`);

  // ★ 設定が 0 件でもポーリングは始める。docs/06 §4 の「判定のたびに読み直す = 再起動不要」は
  //   **設定ファイルを初めて置くとき**にも成り立たないと意味がない。
  //   ここで return すると「設定を置いたのに動かない」= また沈黙になる (2026-08-23 の dogfood で発覚)。
  const enabled = initial.triggers.filter((t) => t.enabled).length;
  logger.info(`[room-triggers] ${initial.triggers.length} 件 (有効 ${enabled} 件) — ${POLL_MS / 1000} 秒ごとに判定します`);
  if (initial.triggers.length > 0) void checkRooms(initial.triggers);

  let warnedSignature = initial.warnings.join('|');
  timer = setInterval(() => {
    void (async () => {
      const { triggers, warnings, mtime } = loadTriggers(configPath);
      // ★ 同じ warn を 10 秒ごとに出さない。ただし内容が変わったら必ず出す
      const signature = warnings.join('|');
      if (signature !== warnedSignature) {
        for (const w of warnings) logger.warn(`[room-triggers] ${w}`);
        warnedSignature = signature;
      }
      const now = new Date();
      const results = await runOnce(triggers, {
        now,
        bootstrapAt: mtime,
        lastFiredAt: lastFiredAtFromRoom,
        latestMatchAt: latestMatchAtFromRoom,
        resolveSender: resolveSenderFromDb,
        post: postAsUser,
      });
      for (const r of results) {
        const line = `[room-triggers] ${r.id}: ${r.fired ? '発火' : '見送り'} — ${r.reason}${r.error ? ` / ★ ${r.error}` : ''}`;
        if (r.error) logger.warn(line);
        else if (shouldReport(r, reported.get(r.id), now)) logger.info(line);
        reported.set(r.id, { reason: r.reason, at: now });
      }
    })();
  }, POLL_MS);
  timer.unref();
}

export function stopRoomTriggers(): void {
  if (timer) clearInterval(timer);
  timer = null;
  reported.clear();
}

/** ポーリング中か (テスト用)。★ 「設定なしでも回っている」を外から確かめられるようにする */
export function isPolling(): boolean {
  return timer !== null;
}
