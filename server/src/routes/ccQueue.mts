/**
 * CC ブリッジの取りに来る口 (#650、docs/14 §5.3、2026-11-23)。agent-server の routes/ccQueue.mts と routes/agent.mts の cc-projects から写した。
 *
 * ★ URL は今までと同じ (`/agent-api/cc-queue/pending`・`/agent-api/cc-queue/stream`・`/agent-api/agent/cc-projects`)。
 *   `/agent-api` の中継より前に置き、**`CC_INTAKE=server` のときだけ**ここで答える。それ以外は中継 (agent-server) に落とす。
 *   流れ (/stream) へ配るのは書く人と同じプロセスの中だけなので、書くのが agent-server で口が本体 (またはその逆) だと、
 *   つながって heartbeat も来るのに便が来ない (静かに外れる)
 * ★ 中継より前 = express.json・requestLog より前なので、断った要求の記録と authenticate を自分で付ける (requestLog は /api/ しか見ない)
 * ★ 部屋のメンバー判定は DB で直接引く (agent-server は呼び主の鍵で本体の /api/rooms を引いていた)。authenticate は is_active を見る
 * ★ 応答の形 (count・max_age_ms・heartbeat_ms・events)・since の意味・15 秒の {"__hb":1}・55 分の __bye は今と同じ
 */
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';
import { errorText } from '../utils/logFormat.mts';
import { authenticate } from '../middleware/auth.mts';
import { getCcQueueDir } from '../services/cc/ccQueue.mts';
import { addSubscriber, removeSubscriber, type CcSubscriber } from '../services/cc/ccSubscribers.mts';
import { ccIntakeEnabled } from '../services/cc/ccIntake.mts';

export const router = express.Router();

/** ★ CC_INTAKE=server でなければ、この router を素通りして中継へ */
router.use((_req: Request, _res: Response, next: NextFunction) => {
  if (!ccIntakeEnabled()) return next('router');
  next();
});
// ★ 断った要求を残す (#650 の監査 3)。共通の requestLog は /api/ だけを記録するので、ここでは効かない。
//   agent-server は「/cc-queue の 401 がどこにも残らなかった」ので記録を足した前例がある。★ 問い合わせ (?…) は残さない (鍵が乗ることがある)
router.use((req: Request, res: Response, next: NextFunction) => {
  res.on('finish', () => {
    if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429) {
      logger.warn(`[http-denied] ${req.method} ${req.baseUrl}${req.path} ${res.statusCode} user=${req.user?.id?.slice(0, 8) ?? '-'} ip=${req.ip ?? '-'} ua=${String(req.get('user-agent') ?? '-').slice(0, 60)}`);
    }
  });
  next();
});

/** project 名の形。★ #459: ファイル名になるので ../ を通さない */
const PROJECT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function heartbeatMs(): number {
  const raw = parseInt(process.env.CC_STREAM_HEARTBEAT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 15000;
}

/**
 * 1 接続の最大寿命 (既定 55 分、#360)。接続時に引いたメンバー判定は古くなるので、寿命で閉じて取り直させる。
 * ★ nginx の read timeout (app.tealus.dev は 60s) を抑えているのは寿命ではなく 15 秒ごとの heartbeat (docs/05)
 */
function maxAgeMs(): number {
  const raw = parseInt(process.env.CC_STREAM_MAX_AGE_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 55 * 60 * 1000;
}

/** 寿命切断の「戻ってくるまでの見込み」。サーバは動き続けているので短くてよい */
const MAX_AGE_EXPECT_BACK_MS = 5000;

interface CcEvent {
  id?: string;
  room_id?: string;
  [key: string]: unknown;
}

/**
 * ★ 受け箱の読み取りは非同期・更新時刻と大きさが変わらなければ前の結果を使う (docs/14 §5.1)。
 *   別の PC の配達役は 5 秒おきに /pending を引く (1 班 1 日 約 17,000 回)。本体は全員のチャットを配るプロセスなので、毎回同期で読まない
 */
const readCache = new Map<string, { mtimeMs: number; size: number; events: CcEvent[] }>();

export function _resetReadCache(): void {
  readCache.clear();
}

async function readEvents(project: string): Promise<CcEvent[]> {
  const filePath = path.join(getCcQueueDir(), `${project}.jsonl`);
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(filePath);
  } catch {
    readCache.delete(filePath);
    return [];
  }
  const hit = readCache.get(filePath);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.events;
  let content: string;
  try {
    content = await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const events: CcEvent[] = [];
  for (const line of content.split('\n')) {
    if (line === '') continue;
    try { events.push(JSON.parse(line) as CcEvent); } catch { /* 壊れた行は捨てる */ }
  }
  readCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, events });
  return events;
}

/**
 * 購読の登録の直後に呼ぶ。読んだ後に受け箱が変わっていれば同期で読み直す (変わっていなければ読んだものをそのまま)。
 * ★ 同期なのは、この間に別の便が live で割り込まないため。受け箱が変わるのは便が来たときだけなので、ほとんどは読み直さない
 */
function readEventsSyncIfChanged(project: string, before: CcEvent[]): CcEvent[] {
  const filePath = path.join(getCcQueueDir(), `${project}.jsonl`);
  let st: fs.Stats;
  try { st = fs.statSync(filePath); } catch { return before; }
  const hit = readCache.get(filePath);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.events;
  const events: CcEvent[] = [];
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      if (line === '') continue;
      try { events.push(JSON.parse(line) as CcEvent); } catch { /* 壊れた行は捨てる */ }
    }
  } catch { return before; }
  readCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, events });
  return events;
}

/**
 * since (= 受け手が最後に受け取った便の id) より後を返す。
 * - since 無し → 空 (tail -n 0 と同じ。過去分は流さない)
 * - 見つからない (切り詰めで消えた・別の班の id) → 残っている全件 (取りこぼすより多く送る方に倒す。件数はログに出す)
 */
function backlogSince(events: CcEvent[], since: string | undefined, project: string): CcEvent[] {
  if (!since) return [];
  const idx = events.findIndex((e) => e.id === since);
  if (idx >= 0) return events.slice(idx + 1);
  logger.warn(`[cc-stream] since=${since} が queue に見つかりません (trim 済みの可能性)。残り ${events.length} 件を全て送ります (project=${project})`);
  return events;
}

async function memberRooms(userId: string): Promise<Set<string>> {
  const r = await pool.query<{ room_id: string }>('SELECT room_id FROM room_members WHERE user_id = $1', [userId]);
  return new Set(r.rows.map((x) => x.room_id));
}

async function prepare(req: Request, res: Response): Promise<{ project: string; allowedRooms: Set<string> } | null> {
  const project = typeof req.query.project === 'string' ? req.query.project : '';
  if (!project) {
    res.status(400).json({ error: 'project が必要です' });
    return null;
  }
  if (!PROJECT_NAME_RE.test(project)) {
    res.status(400).json({ error: 'project の形が不正です' });
    return null;
  }
  try {
    return { project, allowedRooms: await memberRooms(req.user!.id) };
  } catch (err) {
    logger.error(`[cc-stream] 参加ルームの取得に失敗: ${errorText(err)}`);
    res.status(500).json({ error: '参加ルームを取得できませんでした' });
    return null;
  }
}

/**
 * GET /agent-api/cc-queue/pending?project=X[&since=ID][&events=1]
 * 未受信件数。受け手が待ち受けを張る前の疎通確認と、配達役の取り寄せ (events=1、docs/12 §13.3) に使う
 */
router.get('/cc-queue/pending', authenticate, async (req: Request, res: Response) => {
  const ctx = await prepare(req, res);
  if (!ctx) return;
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  const events = await readEvents(ctx.project);
  const pending = (since ? backlogSince(events, since, ctx.project) : events)
    .filter((e) => typeof e.room_id === 'string' && ctx.allowedRooms.has(e.room_id));
  // ★ サーバの設定値を一緒に返す (#361)。受け手は「今の切断が予定どおりか」を自分で判定する
  const withEvents = req.query.events === '1';
  res.json({
    project: ctx.project,
    count: pending.length,
    max_age_ms: maxAgeMs(),
    heartbeat_ms: heartbeatMs(),
    ...(withEvents ? { events: pending } : {}),
  });
});

/**
 * GET /agent-api/cc-queue/stream?project=X[&since=ID]
 * NDJSON (1 便 1 行) を流し続ける。無音のときは {"__hb":1}。寿命で閉じる前に __bye (reason: max_age)
 */
router.get('/cc-queue/stream', authenticate, async (req: Request, res: Response) => {
  const ctx = await prepare(req, res);
  if (!ctx) return;
  const { project, allowedRooms } = ctx;

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',   // nginx の proxy buffering を切る
  });
  res.flushHeaders?.();

  // ★ 受け箱を先に読み、そのあと「購読の登録 → backlog を書く」を await を挟まずに続ける (#650 の監査 6)。
  //   agent-server は同期で読んでいたので、登録と backlog の間に便が来なかった。本体は非同期で読むので、
  //   登録してから await すると、その間の便が live で先に届き、backlog がその後ろに来る (受け手の since が古い id に戻る)。
  //   読んだ後・登録する前に積まれた便を落とさないよう、登録の直後に (変わっていれば) 同期で読み直す
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  const before = await readEvents(project);
  // ★ 準備 (鍵・部屋・受け箱の読み) を待つ間に受け手が切れていたら登録しない (改善ループ 106)。close は 1 回しか出ず、
  //   下で付ける受け口には届かないので、登録すると寿命 (55 分) まで購読者に残り「受け手が並んだまま」を誤って鳴らす
  if (res.destroyed || req.socket.destroyed) return;
  const sub: CcSubscriber = { project, allowedRooms, sink: res, id: randomUUID().slice(0, 6), connectedAt: Date.now() };
  addSubscriber(sub);
  const backlog = backlogSince(readEventsSyncIfChanged(project, before), since, project)
    .filter((e) => typeof e.room_id === 'string' && allowedRooms.has(e.room_id));
  for (const ev of backlog) res.write(JSON.stringify(ev) + '\n');

  const hb = setInterval(() => {
    // ★ 書けたときだけ時刻を進める (届いていない heartbeat を「送った」にしない)
    try {
      res.write('{"__hb":1}\n');
      sub.lastHbAt = Date.now();
    } catch { /* close 側で片付く */ }
  }, heartbeatMs());

  const maxAge = maxAgeMs();
  let expiry: NodeJS.Timeout;
  const cleanup = () => {
    clearInterval(hb);
    clearTimeout(expiry);
    removeSubscriber(sub);
  };

  expiry = setTimeout(() => {
    // ★ 閉じる前に理由を伝える (#366)。受け手が経過秒から逆算すると、時計がずれたとき誤判定する
    // ★ pending は write の前に読む (後で読むと自分が書いた分を数える)
    const pendingBefore = res.writableLength;
    let accepted: boolean | string = 'throw';
    try {
      accepted = res.write(JSON.stringify({ __bye: { reason: 'max_age', expect_back_ms: MAX_AGE_EXPECT_BACK_MS } }) + '\n', (err?: Error | null) => {
        if (err) logger.warn(`[cc-stream] __bye の flush に失敗しました: project=${project} ${err.message}`);
      });
    } catch (err) {
      logger.warn(`[cc-stream] __bye の write が例外を投げました: project=${project} ${errorText(err)}`);
    }
    logger.info(`[cc-stream] __bye 送出: project=${project} id=${sub.id} reason=max_age accepted=${accepted} pending_before=${pendingBefore}B destroyed=${res.destroyed}`);
    cleanup();
    res.end();
  }, maxAge);

  req.on('close', cleanup);
  res.on('close', cleanup);

  // ★ ua・cf-ray を接続の行に残す (§8。中継の切断ログ ccStreamProxyLog が持っていた計器。doctor の cc-main-heartbeat が ua=cc-main を数える)
  const ua = String(req.get('user-agent') ?? '-').slice(0, 60).replace(/\s+/g, '_');
  const ray = String(req.get('cf-ray') ?? '-');
  logger.info(`[cc-stream] 接続: project=${project} id=${sub.id} user=${req.user!.id.slice(0, 8)} rooms=${allowedRooms.size} backlog=${backlog.length} max_age=${Math.round(maxAge / 1000)}s ua=${ua} cf-ray=${ray}`);
});

/**
 * GET /agent-api/agent/cc-projects — 受け箱から班の一覧 (画面の @ の候補、#253)
 * ★ 社内の人だけ (#494 ゲストに班の名前を見せない)。★ CC_QUEUE_DIR を見る (agent-server は既定の場所しか見ていなかった)
 */
router.get('/agent/cc-projects', authenticate, async (req: Request, res: Response) => {
  // 社内の人 = 管理者・一般 (agent-server の configAuthz の staff と同じ)
  if (req.user!.role !== 'admin' && req.user!.role !== 'user') return res.status(403).json({ error: '社内の人だけが使えます' });
  const dir = getCcQueueDir();
  try {
    let files: string[];
    try { files = await fs.promises.readdir(dir); } catch { return res.json({ projects: [] }); }
    const projects: Array<{ name: string; mtime_ms: number }> = [];
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const name = f.slice(0, -6);
      if (!PROJECT_NAME_RE.test(name)) continue;
      let mtimeMs = 0;
      try { mtimeMs = (await fs.promises.stat(path.join(dir, f))).mtimeMs; } catch { /* ignore */ }
      projects.push({ name, mtime_ms: mtimeMs });
    }
    projects.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ projects });
  } catch (err) {
    logger.error(`[cc-projects] list error: ${errorText(err)}`);
    res.status(500).json({ error: 'failed to list cc-projects' });
  }
});
