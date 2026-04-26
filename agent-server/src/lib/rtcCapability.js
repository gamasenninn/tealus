/**
 * agent-server 用 rtc-server reachability watcher。
 *
 * agent-server は server とは別プロセスのため独立判定。30 秒ごとに
 * rtc-server の /health を ping し、結果を内部 state に保持する。
 * ttsSpeak が aivis-cloud 経路を選ぶ前にこの state を参照し、
 * rtc 不可なら browser に動的 degrade する。
 *
 * server 側の capabilityWatcher と同じ flap 抑制 (連続 2 回失敗で disable、
 * 1 回成功で即 enable)。
 */
const logger = require('./logger');

const FLAP_THRESHOLD = 2;
const PING_TIMEOUT_MS = 2000;
const DEFAULT_INTERVAL_MS = 30_000;

let _state = false;
let _consecutiveFailures = 0;
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

async function check() {
  const ok = await ping();
  _consecutiveFailures = ok ? 0 : _consecutiveFailures + 1;
  const newState = ok ? true : (_consecutiveFailures < FLAP_THRESHOLD ? _state : false);
  if (newState !== _state) {
    _state = newState;
    logger.info(`[rtc] availability: ${_state ? 'available' : 'unavailable'}`);
  }
}

function start() {
  check();
  const interval = parseInt(process.env.RTC_HEALTH_INTERVAL || String(DEFAULT_INTERVAL_MS), 10);
  _timer = setInterval(check, interval);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _state = false;
  _consecutiveFailures = 0;
}

function getState() {
  return _state;
}

module.exports = { start, stop, getState, check };
