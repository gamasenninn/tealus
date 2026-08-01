/**
 * cc-queue HTTP ストリーム (#214)
 *
 * `@cc-{project}` の起床通知を **HTTP で受け取れる**ようにする。これまで復路は
 * `~/.tealus/cc-queue/{project}.jsonl` への file append だけで、Claude Code 側が
 * `tail -n 0 -F` で見ていた。**この復路だけが同一ホストを要求していた**ため、
 * AI セッションを別マシンで動かせなかった。
 *
 * 目的は利便性ではなく **隔離** — 本番 DB / メディア / server/.env の秘密鍵がある
 * ホストと、AI が動くホストを分ける。
 *
 * file beacon は**一切変えていない**。本 route はその横に生えた第 2 の出口で、
 * 両方を同時に有効化しないことが運用上の約束 (docs/05)。
 *
 * ★ 認可 (この module の肝):
 *   agent-server の `authenticate` は署名検証のみで DB を見ない (疎結合設計)。
 *   そこで接続時に**呼び出し元のトークンで**本体の `GET /api/rooms` を引き、
 *   参加ルームのイベントだけを配る。beacon を書く bot (agent-server) と、消費して
 *   返信する bot (CC セッション) は**別 principal で参加ルームが違う**ため、
 *   絞らないと「返信できない (bot API が 403) イベントで起こされる」うえ、
 *   読み手の権限を超えた本文が HTTP に流れる。
 *   この転送は同時に、**無効化されたユーザーのトークンの穴も塞ぐ** (本体側が 401 を返す)。
 */
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import * as config from '../config.mts';
import { logger } from '../lib/logger.mts';
import { getCcQueueDir } from '../webhook/ccQueue.mts';
import { addSubscriber, removeSubscriber, type CcSubscriber } from '../webhook/ccSubscribers.mts';

export const router = express.Router();

/** 無音でも接続を維持するための heartbeat 間隔 (ms)。クライアント側でフィルタして捨てる */
function heartbeatMs(): number {
  const raw = parseInt(process.env.CC_STREAM_HEARTBEAT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 15000;
}

/**
 * 1 接続の最大寿命 (ms)。既定 55 分 (#360)。
 *
 * ★ なぜ必要か: 認可 (`allowedRooms`) は接続時に `/api/rooms` を引いた**スナップショット**で、
 *   JWT の検証も入口で 1 回だけ。接続が長生きするほど権限が古くなり、
 *   「ルームから外された / ユーザーが無効化された / トークンが失効した」のどれも
 *   開いている接続を止めない。実測で 2 時間 26 分無切断の接続が出たため顕在化した。
 *
 *   → こちらから寿命で閉じ、**クライアントの再接続ループに再ログイン + 再認可をさせる**。
 *     取りこぼしは `since` (受信済みカーソル) が防ぐので、消費側の変更は要らない。
 *
 *   既定を 55 分にしているのは、nginx の `proxy_read_timeout 3600s` (1 時間) より短く取り、
 *   タイムアウト境界での不定な切れ方より**こちらの意図した切断を先に来させる**ため。
 */
function maxAgeMs(): number {
  const raw = parseInt(process.env.CC_STREAM_MAX_AGE_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 55 * 60 * 1000;
}

interface CcEvent {
  id?: string;
  room_id?: string;
  [key: string]: unknown;
}

/** project の jsonl を読んで event 配列にする。file が無ければ空配列 */
function readEvents(project: string): CcEvent[] {
  const filePath = path.join(getCcQueueDir(), `${project}.jsonl`);
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const events: CcEvent[] = [];
  for (const line of content.split('\n')) {
    if (line === '') continue;
    try { events.push(JSON.parse(line) as CcEvent); } catch { /* 壊れた行は捨てる */ }
  }
  return events;
}

/**
 * `since` (= クライアントが最後に受信した event id) 以降の backlog を返す。
 *
 * - `since` 無し → 空 (file モードの `tail -n 0` と等価。過去分は流さない)
 * - `since` が見つからない (trim で消えた / 別 project の id) → **残っている全件**。
 *   取りこぼすより多く送る方に倒す。件数はログに出す (黙って落とさない)
 */
function backlogSince(events: CcEvent[], since: string | undefined, project: string): CcEvent[] {
  if (!since) return [];
  const idx = events.findIndex((e) => e.id === since);
  if (idx >= 0) return events.slice(idx + 1);
  logger.warn(`[cc-stream] since=${since} が queue に見つかりません (trim 済みの可能性)。残り ${events.length} 件を全て送ります (project=${project})`);
  return events;
}

/**
 * 呼び出し元のトークンで本体の参加ルームを引く。
 * @returns 参加 room id の Set。本体が 401 を返したら null (= こちらも 401)
 */
async function resolveAllowedRooms(req: Request): Promise<Set<string> | null> {
  const auth = req.headers.authorization as string;
  const res = await fetch(`${config.TEALUS_API_URL}/api/rooms`, {
    headers: { Authorization: auth },
  } as RequestInit);

  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`GET /api/rooms が ${res.status} を返しました`);

  const body = await res.json() as { rooms?: Array<{ id?: string }> };
  const rooms = Array.isArray(body.rooms) ? body.rooms : [];
  return new Set(rooms.map((r) => r.id).filter((id): id is string => typeof id === 'string'));
}

/** project / 認可を解決する共通前処理。解決できなければ res を送って null を返す */
async function prepare(req: Request, res: Response): Promise<{ project: string; allowedRooms: Set<string> } | null> {
  const project = typeof req.query.project === 'string' ? req.query.project : '';
  if (!project) {
    res.status(400).json({ error: 'project が必要です' });
    return null;
  }

  let allowedRooms: Set<string> | null;
  try {
    allowedRooms = await resolveAllowedRooms(req);
  } catch (err) {
    logger.error(`[cc-stream] 参加ルームの取得に失敗: ${err instanceof Error ? err.message : String(err)}`);
    res.status(502).json({ error: '本体サーバに接続できません' });
    return null;
  }
  if (!allowedRooms) {
    res.status(401).json({ error: 'トークンが無効です' });
    return null;
  }
  return { project, allowedRooms };
}

/**
 * GET /cc-queue/pending?project=X[&since=ID]
 *
 * 未受信件数を返す。**arm する前の疎通確認**がこの endpoint の主目的で、
 * 200 が返らなければクライアントは Monitor を張らずにユーザーへ提示して止まる
 * (張ってしまうと失敗が silent になる)。
 */
router.get('/pending', async (req, res) => {
  const ctx = await prepare(req, res);
  if (!ctx) return;

  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  const events = readEvents(ctx.project);
  const pending = (since ? backlogSince(events, since, ctx.project) : events)
    .filter((e) => typeof e.room_id === 'string' && ctx.allowedRooms.has(e.room_id));

  res.json({ project: ctx.project, count: pending.length });
});

/**
 * GET /cc-queue/stream?project=X[&since=ID]
 *
 * NDJSON (1 event 1 行) を流し続ける。SSE ではない — `tail -F` と同じ「行が来る」形なので
 * 消費側 (Claude Code の Monitor) の扱いが変わらない。
 *
 * - `since` は **watermark ではなく受信済みカーソル**。切断中のイベントを拾えて、
 *   かつ「保留中の未処理が再提示され続ける」ことがない
 * - 無音時は heartbeat `{"__hb":1}` を流す。クライアントはパイプで捨てる (起床させない)
 * - 切断時は購読解除 + heartbeat 停止
 */
router.get('/stream', async (req, res) => {
  const ctx = await prepare(req, res);
  if (!ctx) return;

  const { project, allowedRooms } = ctx;

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',   // nginx の proxy buffering を明示的に切る
  });
  res.flushHeaders?.();

  // 先に購読を登録する: backlog を書いている間に来たイベントも落とさない
  // (NDJSON なので順序が多少前後しても、消費側は id で判断できる)
  const sub: CcSubscriber = { project, allowedRooms, sink: res };
  addSubscriber(sub);

  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  const backlog = backlogSince(readEvents(project), since, project)
    .filter((e) => typeof e.room_id === 'string' && allowedRooms.has(e.room_id));
  for (const ev of backlog) res.write(JSON.stringify(ev) + '\n');

  const hb = setInterval(() => {
    try { res.write('{"__hb":1}\n'); } catch { /* close 側で片付く */ }
  }, heartbeatMs());

  // 寿命が来たらこちらから閉じる。クライアントの再接続ループが再ログイン + 再認可する
  const maxAge = maxAgeMs();
  let expiry: NodeJS.Timeout;

  const cleanup = () => {
    clearInterval(hb);
    clearTimeout(expiry);
    removeSubscriber(sub);
  };

  expiry = setTimeout(() => {
    logger.info(`[cc-stream] 最大寿命 (${Math.round(maxAge / 1000)}s) に達したため切断します: project=${project} — クライアントが再接続して認可を取り直します`);
    cleanup();
    res.end();
  }, maxAge);

  req.on('close', cleanup);
  res.on('close', cleanup);

  logger.info(`[cc-stream] 接続: project=${project} rooms=${allowedRooms.size} backlog=${backlog.length} max_age=${Math.round(maxAge / 1000)}s`);
});
