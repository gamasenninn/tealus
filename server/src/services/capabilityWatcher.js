/**
 * Capability Watcher — rtc-server 到達可能性を runtime で検出する。
 *
 * server boot 時に start() を呼び、以降 RTC_HEALTH_INTERVAL ごとに
 * rtc-server の /health を ping。状態変化時のみ Socket.IO で全 client に
 * 'capability:changed' イベントを emit。
 *
 * flap 抑制:
 *   - 連続 FLAP_THRESHOLD 回失敗で disable に降格 (一時的揺らぎ吸収)
 *   - 1 回成功で即 enable に昇格 (復旧の即応性)
 *
 * /api/config からは getState() で現在値が読める。
 */
const logger = require('../utils/logger');

const FLAP_THRESHOLD = 2;
const PING_TIMEOUT_MS = 2000;
const DEFAULT_INTERVAL_MS = 30_000;

let _state = false;
let _consecutiveFailures = 0;
let _io = null;
let _timer = null;

async function ping() {
  const port = process.env.RTC_PORT || 3100;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
    const r = await fetch(`http://localhost:${port}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

async function checkAndEmit() {
  const ok = await ping();
  _consecutiveFailures = ok ? 0 : _consecutiveFailures + 1;

  // 失敗時: 連続 N 回失敗するまで前の状態を維持
  // 成功時: 即座に true へ
  const newState = ok ? true : (_consecutiveFailures < FLAP_THRESHOLD ? _state : false);

  if (newState !== _state) {
    _state = newState;
    logger.info(`Realtime voice: ${_state ? 'available' : 'unavailable'}`);
    if (_io) {
      _io.emit('capability:changed', {
        realtime_voice_available: _state,
        changed_at: new Date().toISOString(),
      });
    }
  }
}

/**
 * Watcher を起動する。Socket.IO の `io` を渡すと状態変化時に emit する。
 * 初回 ping を即実行し、以降は定期 poll。
 */
function start(io) {
  _io = io;
  checkAndEmit();
  const interval = parseInt(process.env.RTC_HEALTH_INTERVAL || String(DEFAULT_INTERVAL_MS), 10);
  _timer = setInterval(checkAndEmit, interval);
}

/**
 * Watcher を停止する (テスト時の teardown 用)。
 */
function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  // テスト用にカウンタもリセット
  _state = false;
  _consecutiveFailures = 0;
  _io = null;
}

/**
 * 現在の状態を返す。/api/config 等から呼び出す。
 */
function getState() {
  return _state;
}

/**
 * テスト用: 内部状態を直接書き換えずに ping 経由でだけ更新するため、
 * テストでは ping を mock する想定。
 */
module.exports = { start, stop, getState, checkAndEmit };
