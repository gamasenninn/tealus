/**
 * 配達役の入口 (docs/12)。`node src/index.mts` で動かす。本体・agent-server とは別のプロセス。
 *
 * - 置き場: ~/.tealus/courier/ (bridges.json・auth.json・カーソル・鍵・保留の印・出来事の記録)。cc-queue のフォルダには書かない
 * - ★ 既定は空回し (打たずに記録だけ)。本当に配るのは bridges.json に dry_run: false と書いた班だけ。
 *   COURIER_DRY_RUN=1 ならどの班も空回し (docs/12 §12.11)
 * - 3 秒ごとに班ごとの輪を 1 回。1 分ごとに鼓動 (班の名前・状態・件数と problem)
 * - 起動時に班ごとの鍵を取る。取れない班 (生きている別の配達役が持っている) は配らない
 * - 外のコマンド (herdr) はこの機械で execFile (シェルを通さない。引数は形を確かめた値だけ)
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadBridges } from './config.mts';
import { herdrCourier, type Run } from './herdr.mts';
import { sshRun } from './ssh.mts';
import { tickBridge, type Bridge, type BridgeReport } from './tick.mts';
import { RateLimiter } from './limit.mts';
import { acquireLock, releaseLock } from './lock.mts';
import { heartbeatInfo } from './heartbeat.mts';
import { heartbeatSender, type CourierAuth } from './sendHeartbeat.mts';
import { httpQueueMirror } from './httpQueue.mts';

const COURIER_DIR = process.env.COURIER_DIR || path.join(os.homedir(), '.tealus', 'courier');
const QUEUE_DIR = process.env.CC_QUEUE_DIR || path.join(os.homedir(), '.tealus', 'cc-queue');
/** ★ 全体の空回し。COURIER_DRY_RUN=1 ならどの班も空回し。0 (や未設定) なら班ごとの dry_run に従う (既定は空回し) */
const DRY_RUN = process.env.COURIER_DRY_RUN === '1';
const TICK_MS = 3_000;
/** 配達役の起動時刻 (鼓動に載せる。それより前の班の状態は覚えていない) */
const STARTED_AT = Date.now();
const HEARTBEAT_MS = 60_000;
/** ★ 班の状態が変わったら 1 分を待たずに送る (管理画面の一覧を早く変えるため、2026-11-20)。ただし続けて送るのは 5 秒あける */
const HEARTBEAT_MIN_GAP_MS = 5_000;
/** 段階 3 (docs/12 §14): agent-server から便を取り寄せる間隔と、取り寄せた写しの置き場 */
const MIRROR_MS = 5_000;
const MIRROR_DIR = path.join(COURIER_DIR, 'queue-mirror');

function log(line: string): void {
  console.log(`${new Date().toISOString()} [courier] ${line}`);
}

/** 出来事の記録 (本文は入らない)。~/.tealus/courier/events-YYYYMMDD.jsonl */
function record(event: Record<string, unknown>): void {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    fs.appendFileSync(path.join(COURIER_DIR, `events-${day}.jsonl`), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
  } catch { /* 記録の失敗で配達を止めない */ }
}

const run: Run = (command, args) => new Promise((resolve) => {
  execFile(command, args, { timeout: 30_000, windowsHide: true }, (err, stdout, stderr) => {
    const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
    resolve({ code, stdout: String(stdout), stderr: String(stderr) });
  });
});

function loadAuth(): CourierAuth | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(COURIER_DIR, 'auth.json'), 'utf8')) as Partial<CourierAuth>;
    return v.api_url && v.login_id && v.password ? (v as CourierAuth) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(COURIER_DIR, { recursive: true });
  const loaded = loadBridges(COURIER_DIR);
  if (!loaded.ok) { log(`止まります: ${loaded.reason}`); process.exit(1); }
  for (const s of loaded.skipped) log(`使わない登録: ${s}`);

  const auth = loadAuth();
  const bridges: Bridge[] = [];
  const httpProjects: string[] = [];
  for (const b of loaded.bridges) {
    // ★ 段階 3 は取り寄せにログインが要る。auth.json が無ければその班は配らない (古い写しで配り続けない)
    if (b.queue === 'http' && !auth) { log(`${b.project}: 便を HTTP で取り寄せる班ですが auth.json が無いので配りません`); continue; }
    if (!acquireLock(COURIER_DIR, b.project)) { log(`${b.project}: 別の配達役が鍵を持っているので配りません`); continue; }
    // ★ herdr-ssh (docs/12 §13): 相手の PC の herdr を SSH で呼ぶ。判断 (状態の読み方・打ち方) は手元の herdr と同じ
    const courier = b.adapter === 'herdr-ssh'
      ? herdrCourier(sshRun(run, { host: b.host!, user: b.user! }), b.agent, { bin: b.herdr! })
      : herdrCourier(run, b.agent, { bin: process.env.HERDR_BIN || 'herdr' });
    bridges.push({ project: b.project, courier, dryRun: b.dryRun, ...(b.queue === 'http' ? { queueDir: MIRROR_DIR } : {}) });
    if (b.queue === 'http') httpProjects.push(b.project);
  }
  log(`始めます: ${bridges.map((b) => `${b.project}${DRY_RUN || b.dryRun ? '(空回し)' : '(本番)'}${b.queueDir ? '(HTTP)' : ''}`).join(', ') || '(なし)'}`);

  const release = () => { for (const b of bridges) releaseLock(COURIER_DIR, b.project); process.exit(0); };
  process.on('SIGINT', release);
  process.on('SIGTERM', release);

  const limiter = new RateLimiter();
  if (!auth) log('auth.json が無いので鼓動を送りません (配達は続けます)');
  const sendHb = auth ? heartbeatSender(auth) : null;
  const latest = new Map<string, BridgeReport>();
  let lastHb = 0;
  let changed = false;
  const mirror = auth && httpProjects.length ? httpQueueMirror(auth) : null;
  let lastMirror = 0;
  /** 取り寄せの失敗が続いた回数 (班ごと)。1・10・100 回目だけ記録に出す (5 秒ごとに書かない) */
  const mirrorFails = new Map<string, number>();

  for (;;) {
    if (mirror && Date.now() - lastMirror >= MIRROR_MS) {
      lastMirror = Date.now();
      for (const p of httpProjects) {
        const m = await mirror(p, MIRROR_DIR);
        const n = m.ok ? 0 : (mirrorFails.get(p) ?? 0) + 1;
        if (!m.ok && (n === 1 || n === 10 || n === 100)) log(`${p}: 便を取り寄せられません (${n} 回目): ${m.reason}`);
        if (m.ok && (mirrorFails.get(p) ?? 0) > 0) log(`${p}: 便の取り寄せが戻りました`);
        mirrorFails.set(p, n);
      }
    }
    for (const b of bridges) {
      try {
        const r = await tickBridge(b, {
          queueDir: QUEUE_DIR, stateDir: COURIER_DIR, limiter, now: Date.now, dryRun: DRY_RUN, record,
          onHold: (p, reason) => log(`${p}: 保留しました (${reason})。~/.tealus/courier/hold-${p}.json を消すと戻ります`),
        });
        const prev = latest.get(b.project);
        if (!prev || prev.state !== r.state) { log(`${b.project}: ${r.state} (新着 ${r.pending} 件)`); changed = true; }
        else if (prev.pending !== r.pending) changed = true;
        latest.set(b.project, r);
      } catch (err) {
        log(`${b.project}: 輪の途中で失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const since = Date.now() - lastHb;
    if (sendHb && (since >= HEARTBEAT_MS || (changed && since >= HEARTBEAT_MIN_GAP_MS))) {
      lastHb = Date.now();
      changed = false;
      const ok = await sendHb(heartbeatInfo([...latest.values()], Date.now(), STARTED_AT));
      if (!ok) log('鼓動を送れませんでした (配達は続けます)');
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

void main();
