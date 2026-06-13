/**
 * In-flight rooms tracker (#292 SPIKE / cross-room task delegation)
 *
 * dispatcher が処理中の room を ref-counted Map で管理する。
 * handler.js は bot 送信 webhook 時に isInflight(roomId) を引いて:
 *   true  → 自送 echo として block (= dispatcher が応答中の room と一致)
 *   false → cross-room delegation として通す (= 別 room AGENT を起動させたい場合)
 *
 * - 並行 dispatch が同 room で同時起動する case を ref-count で扱う
 *   (= 片方の release で他方の in-flight が外れる事故を防ぐ)
 * - pushMessage 完了後の late webhook 到達 (= server async 発火による race) を
 *   吸収するため release は遅延実行する (= dispatcher 終了直後の echo を確実に block)
 *
 * 通常運用 (ENABLE_CROSS_ROOM_DELEGATION=false) では dispatcher が add を呼ばないので
 * isInflight は常に false (= handler は旧挙動の一律 bot skip path に乗る)。
 */

const RELEASE_DELAY_MS = 2000;

// room_id → ref count
const counts = new Map();

/**
 * dispatcher 処理開始時に呼ぶ。
 * @param {string} roomId
 */
function add(roomId) {
  if (!roomId) return;
  counts.set(roomId, (counts.get(roomId) || 0) + 1);
}

/**
 * dispatcher 処理終了時に呼ぶ (= finally で必ず call)。
 * 即時 decrement ではなく、late webhook 吸収のため遅延 release。
 * @param {string} roomId
 * @param {number} [delayMs] テスト用に上書き可能
 */
function release(roomId, delayMs = RELEASE_DELAY_MS) {
  if (!roomId) return;
  const timer = setTimeout(() => {
    const cur = counts.get(roomId) || 0;
    if (cur <= 1) counts.delete(roomId);
    else counts.set(roomId, cur - 1);
  }, delayMs);
  // Node プロセス終了を block しない
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * handler.js が bot 送信 webhook を block するか判定する。
 * @param {string} roomId
 * @returns {boolean}
 */
function isInflight(roomId) {
  if (!roomId) return false;
  return counts.has(roomId);
}

/**
 * テスト用 reset。
 */
function _reset() {
  counts.clear();
}

module.exports = { add, release, isInflight, _reset, RELEASE_DELAY_MS };
