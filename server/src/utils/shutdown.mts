/**
 * #368 本体サーバの graceful shutdown。
 *
 * 背景: 本体サーバには長らく `SIGINT` / `SIGTERM` ハンドラが無く、停止時に
 * ハンドラを通らずプロセスが死んでいた。接続もタイマーも DB プールも後始末されない。
 *
 * ★ とくに効くのが cc-queue の中継である。別マシンの CC セッションは
 *   `/agent-api/cc-queue/stream` に繋いでおり、**その中継を握っているのは本体サーバの
 *   プロセス**なので、本体が死ぬと agent-server が無傷でもブリッジが切れる。
 *   そして `__bye` を出せるのは agent-server 自身の停止時だけなので、**予告のしようが
 *   なかった** (2026-08-04、別マシンで `curl=92` = HTTP/2 ストリーム破損を実測)。
 *   → 停止ハンドラから agent-server に一段渡して予告させる (`notifyGateway`)。
 *
 * 実資源 (http server / socket.io / pool / timer) を注入で受け取り、テストが
 * それらに触れずに**手順と順序**を検証できるようにしてある
 * (`services/migrationCheck.mts` の `{ query, warn }` と同じパターン)。
 *
 * @module utils/shutdown
 */

/** 予告が proxy を通って別マシンへ届くまでの待ち。これを挟まず接続を切ると予告が消える。 */
const NOTIFY_SETTLE_MS = 200;

/**
 * ★ winston の file transport は非同期。`process.exit` を即座に呼ぶと直前のログが
 * 書き出される前に落ちる。2026-08-02 に agent-server 側で実際に踏んだ
 * (`__bye` は正しく送信されているのにログの行だけが消えた = 動いているのに見えない)。
 */
const LOG_FLUSH_MS = 200;

/** 後始末全体の上限。1 つが返らなくても停止そのものは必ず完了させる。 */
export const SHUTDOWN_TIMEOUT_MS = 5000;

export interface ShutdownDeps {
  /** 情報ログ (本番は logger.info)。 */
  log: (message: string) => void;
  /** 警告ログ (本番は logger.warn)。後始末の失敗はここに出すだけで停止は続行する。 */
  warn: (message: string) => void;
  /** ★ agent-server に停止を伝え、cc-queue 購読者へ予告させる。失敗は許容する。 */
  notifyGateway: () => Promise<void>;
  /** unref されていない interval を止める (capabilityWatcher / organonWatcher)。 */
  stopTimers: () => void;
  /** 新規受付を止める (server.close)。★ await しない — 下記参照。 */
  closeServer: () => void;
  /** 残っている接続を明示的に切る (server.closeAllConnections)。 */
  closeConnections: () => void;
  /** Socket.IO を閉じる (io.close)。 */
  closeIo: () => void;
  /** DB プールを閉じる (pool.end)。 */
  endPool: () => Promise<void>;
  /** 意図的な待ち。 */
  sleep: (ms: number) => Promise<void>;
  /** 上限時間。既定は実時間の setTimeout (テストは即時 / 無限に差し替える)。 */
  deadline: (ms: number) => Promise<void>;
  /** プロセス終了 (本番は process.exit)。 */
  exit: (code: number) => void;
  /** 上限時間の上書き (既定 SHUTDOWN_TIMEOUT_MS)。 */
  timeoutMs?: number;
}

/** 実時間の上限タイマー。イベントループを延命しないよう unref する。 */
export function realDeadline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/** 実時間の sleep。 */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * 停止手順を順に実行し、最後に exit する。
 *
 * ★ 順序に意味がある:
 * - **予告 (notifyGateway) は接続を切るより前**。中継が消えた後では届かない
 * - `closeServer` は **await しない**。`server.close()` は既存接続の終了を待つが、
 *   cc-queue の中継は永久に終わらないので callback が来ない。
 *   代わりに `closeConnections()` で明示的に切る
 * - 各手順は個別に握りつぶす。`closeIo` は `closeServer` の後だと
 *   `ERR_SERVER_NOT_RUNNING` を投げうるが、そこで止まると DB プールが残る
 */
export async function runShutdown(deps: ShutdownDeps): Promise<void> {
  const timeoutMs = deps.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  let exited = false;
  const exitOnce = (code: number): void => {
    if (exited) return;
    exited = true;
    deps.exit(code);
  };

  const step = (label: string, fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      deps.warn(`[shutdown] ${label} に失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const stepAsync = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      deps.warn(`[shutdown] ${label} に失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const sequence = async (): Promise<void> => {
    deps.log('Shutting down...');
    // ★ 中継が生きているうちに予告する。agent-server 不達でも停止は続ける
    await stepAsync('停止の予告', deps.notifyGateway);
    await deps.sleep(NOTIFY_SETTLE_MS);
    step('タイマーの停止', deps.stopTimers);
    step('新規受付の停止', deps.closeServer);
    step('接続の切断', deps.closeConnections);
    step('Socket.IO の終了', deps.closeIo);
    await stepAsync('DB プールの終了', deps.endPool);
    await deps.sleep(LOG_FLUSH_MS);
  };

  try {
    await Promise.race([
      sequence(),
      deps.deadline(timeoutMs).then(() => {
        deps.warn(`[shutdown] 上限 ${timeoutMs}ms を超えたため後始末を打ち切ります`);
      }),
    ]);
  } catch (e) {
    // sequence 内は個別に握りつぶしてあるので通常ここには来ない (最後の網)
    deps.warn(`[shutdown] 予期しない失敗: ${e instanceof Error ? e.message : String(e)}`);
  }
  exitOnce(0);
}

/**
 * `process.on('SIGINT' / 'SIGTERM')` に渡すハンドラを作る。
 *
 * ★ 2 回目の signal では待たずに `exit(1)`。後始末が止まったときに押し直せる
 *   (上限時間もあるが、人が待てない場合の逃げ道を残す)。
 *   フラグは closure に持つ = モジュール状態を作らないのでテストが独立する。
 */
export function createSignalHandler(deps: ShutdownDeps): () => void {
  let started = false;
  return () => {
    if (started) {
      deps.warn('[shutdown] 2 回目の signal を受けたため、後始末を待たずに終了します');
      deps.exit(1);
      return;
    }
    started = true;
    void runShutdown(deps);
  };
}
