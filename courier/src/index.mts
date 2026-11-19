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
import { tickBridge, type Bridge, type BridgeReport } from './tick.mts';
import { RateLimiter } from './limit.mts';
import { acquireLock, releaseLock } from './lock.mts';
import { heartbeatInfo } from './heartbeat.mts';
import { heartbeatSender, type CourierAuth } from './sendHeartbeat.mts';

const COURIER_DIR = process.env.COURIER_DIR || path.join(os.homedir(), '.tealus', 'courier');
const QUEUE_DIR = process.env.CC_QUEUE_DIR || path.join(os.homedir(), '.tealus', 'cc-queue');
/** ★ 全体の空回し。COURIER_DRY_RUN=1 ならどの班も空回し。0 (や未設定) なら班ごとの dry_run に従う (既定は空回し) */
const DRY_RUN = process.env.COURIER_DRY_RUN === '1';
const TICK_MS = 3_000;
const HEARTBEAT_MS = 60_000;

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

  const bridges: Bridge[] = [];
  for (const b of loaded.bridges) {
    if (!acquireLock(COURIER_DIR, b.project)) { log(`${b.project}: 別の配達役が鍵を持っているので配りません`); continue; }
    bridges.push({ project: b.project, courier: herdrCourier(run, b.agent, { bin: process.env.HERDR_BIN || 'herdr' }), dryRun: b.dryRun });
  }
  log(`始めます: ${bridges.map((b) => `${b.project}${DRY_RUN || b.dryRun ? '(空回し)' : '(本番)'}`).join(', ') || '(なし)'}`);

  const release = () => { for (const b of bridges) releaseLock(COURIER_DIR, b.project); process.exit(0); };
  process.on('SIGINT', release);
  process.on('SIGTERM', release);

  const limiter = new RateLimiter();
  const auth = loadAuth();
  if (!auth) log('auth.json が無いので鼓動を送りません (配達は続けます)');
  const sendHb = auth ? heartbeatSender(auth) : null;
  const latest = new Map<string, BridgeReport>();
  let lastHb = 0;

  for (;;) {
    for (const b of bridges) {
      try {
        const r = await tickBridge(b, {
          queueDir: QUEUE_DIR, stateDir: COURIER_DIR, limiter, now: Date.now, dryRun: DRY_RUN, record,
          onHold: (p, reason) => log(`${p}: 保留しました (${reason})。~/.tealus/courier/hold-${p}.json を消すと戻ります`),
        });
        const prev = latest.get(b.project);
        if (!prev || prev.state !== r.state) log(`${b.project}: ${r.state} (新着 ${r.pending} 件)`);
        latest.set(b.project, r);
      } catch (err) {
        log(`${b.project}: 輪の途中で失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (sendHb && Date.now() - lastHb >= HEARTBEAT_MS) {
      lastHb = Date.now();
      const ok = await sendHb(heartbeatInfo([...latest.values()], Date.now()));
      if (!ok) log('鼓動を送れませんでした (配達は続けます)');
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

void main();
