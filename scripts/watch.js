/**
 * ファイル監視ロジック
 * transcriber.py の wait_for_file_complete / WavHandler パターンをNode.jsに移植
 */
const fs = require('fs');
const path = require('path');

/**
 * ファイルの書き込みが完了するまで待つ
 * サイズが一定回数連続で変化しなければ完了と判定
 *
 * @param {string} filePath - 監視対象ファイルパス
 * @param {object} opts - オプション
 * @param {number} opts.interval - チェック間隔(ms) デフォルト1000
 * @param {number} opts.stableCount - 安定判定回数 デフォルト2
 * @param {number} opts.timeout - タイムアウト(ms) デフォルト60000
 * @returns {Promise<boolean>} 完了したらtrue、タイムアウトでfalse
 */
async function waitForFileComplete(filePath, opts = {}) {
  const interval = opts.interval || 1000;
  const stableCount = opts.stableCount || 2;
  const timeout = opts.timeout || 60000;

  let lastSize = -1;
  let stable = 0;
  let elapsed = 0;

  while (elapsed < timeout) {
    try {
      const stat = fs.statSync(filePath);
      const currentSize = stat.size;
      if (currentSize === lastSize && currentSize > 0) {
        stable++;
        if (stable >= stableCount) {
          return true;
        }
      } else {
        stable = 0;
      }
      lastSize = currentSize;
    } catch (e) {
      return false;
    }

    await new Promise(resolve => setTimeout(resolve, interval));
    elapsed += interval;
  }

  return false;
}

/**
 * ディレクトリを監視し、新規ファイルをコールバックで通知
 * デバウンス処理付き（同一ファイルの短時間連続イベントを抑制）
 *
 * @param {string} dir - 監視ディレクトリ
 * @param {string[]} extensions - 対象拡張子 例: ['.wav', '.mp4']
 * @param {function} onFile - 新規ファイル検知時のコールバック (filePath) => void
 * @returns {function} 停止関数
 */
function watchDirectory(dir, extensions, onFile) {
  const seen = new Map(); // ファイル名 → タイムスタンプ（デバウンス用）
  const DEBOUNCE_MS = 2000;

  const watcher = fs.watch(dir, (eventType, filename) => {
    if (!filename) return;

    const ext = path.extname(filename).toLowerCase();
    if (!extensions.includes(ext)) return;

    // デバウンス: 同一ファイルの短時間連続イベントを無視
    const now = Date.now();
    const lastSeen = seen.get(filename);
    if (lastSeen && (now - lastSeen) < DEBOUNCE_MS) return;
    seen.set(filename, now);

    const filePath = path.join(dir, filename);

    // ファイルが存在するか確認（削除イベントを除外）
    if (!fs.existsSync(filePath)) return;

    onFile(filePath);
  });

  return function stop() {
    watcher.close();
  };
}

module.exports = { waitForFileComplete, watchDirectory };
