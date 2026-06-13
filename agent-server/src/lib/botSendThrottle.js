/**
 * #292 SPIKE safety net: bot send 制限 (= Risk 3 cross-room N hop chain 対策)
 *
 * 2 layer 防御:
 *   1. soft trip (= SPIKE_TRIP_THRESHOLD): sliding 60s window 内の bot 送信総数が
 *      threshold を超えたら spikeTripped=true、handler.js が cross-room delegation を
 *      runtime で disable する (= env=false と同等に bot 送信を一律 block)
 *   2. hard cap (= HARD_CAP): window 内の送信総数が hard cap に達したら
 *      checkAndRecord が false を返し、botApi が send 自体を reject (throw)
 *
 * trip は one-way (= 復帰には agent-server restart 必要)。
 * SPIKE phase の安全 net、自動 recovery は意図的に入れない (= 同 trigger で再暴走防止)。
 *
 * window 計算は sliding (= timestamp 配列を prune)、計算量は O(N) だが N が小さい (< HARD_CAP)。
 */

const WINDOW_MS = 60 * 1000;
const SPIKE_TRIP_THRESHOLD = 30;
const HARD_CAP = 60;

const sendTimestamps = [];
let spikeTripped = false;
let spikeTrippedAt = null;

function _prune(now) {
  while (sendTimestamps.length && now - sendTimestamps[0] > WINDOW_MS) {
    sendTimestamps.shift();
  }
}

/**
 * bot send 系 (= pushMessage/pushImage/pushFile) の冒頭で呼ぶ。
 *
 * @returns {{ok: boolean, justTripped: boolean, reason?: string, windowCount: number}}
 *   ok=false なら hard cap 抵触で送信は reject されるべき。
 *   justTripped=true なら今回の call で soft trip した (= 初回 log warn 用)。
 */
function checkAndRecord() {
  const now = Date.now();
  _prune(now);

  if (sendTimestamps.length >= HARD_CAP) {
    return { ok: false, justTripped: false, reason: 'hard-cap', windowCount: sendTimestamps.length };
  }

  sendTimestamps.push(now);
  let justTripped = false;
  if (sendTimestamps.length >= SPIKE_TRIP_THRESHOLD && !spikeTripped) {
    spikeTripped = true;
    spikeTrippedAt = now;
    justTripped = true;
  }
  return { ok: true, justTripped, windowCount: sendTimestamps.length };
}

/**
 * handler.js が cross-room delegation を許可するかの判定。
 * tripped 中は SPIKE 機能 OFF (= 旧挙動 fallback)。
 */
function isSpikeTripped() {
  return spikeTripped;
}

function getStats() {
  return {
    windowMs: WINDOW_MS,
    spikeTripThreshold: SPIKE_TRIP_THRESHOLD,
    hardCap: HARD_CAP,
    currentWindowCount: sendTimestamps.length,
    spikeTripped,
    spikeTrippedAt,
  };
}

function _reset() {
  sendTimestamps.length = 0;
  spikeTripped = false;
  spikeTrippedAt = null;
}

module.exports = {
  checkAndRecord,
  isSpikeTripped,
  getStats,
  _reset,
  WINDOW_MS,
  SPIKE_TRIP_THRESHOLD,
  HARD_CAP,
};
