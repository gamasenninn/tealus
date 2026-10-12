/**
 * ファイル監視ロジック
 * transcriber.py の wait_for_file_complete / WavHandler パターンをNode.jsに移植
 */
import fs from 'node:fs';
import path from 'node:path';

export interface WaitOptions {
  /** チェック間隔(ms) デフォルト1000 */
  interval?: number;
  /** 安定判定回数 デフォルト2 */
  stableCount?: number;
  /** タイムアウト(ms) デフォルト60000 */
  timeout?: number;
}

/**
 * ファイルの書き込みが完了するまで待つ
 * サイズが一定回数連続で変化しなければ完了と判定
 *
 * @returns 完了したらtrue、タイムアウトでfalse
 */
export async function waitForFileComplete(filePath: string, opts: WaitOptions = {}): Promise<boolean> {
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
    } catch {
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
 * @returns 停止関数
 */
export function watchDirectory(
  dir: string,
  extensions: string[],
  onFile: (filePath: string) => void | Promise<void>
): () => void {
  const sent = new Set<string>();         // 送信済みファイル名（重複送信防止）
  const seen = new Map<string, number>(); // ファイル名 → タイムスタンプ（デバウンス用）
  const DEBOUNCE_MS = 2000;

  // 起動時に既存ファイルを送信済みとして記録
  try {
    fs.readdirSync(dir).forEach(f => {
      const ext = path.extname(f).toLowerCase();
      if (extensions.includes(ext)) sent.add(f);
    });
  } catch { /* ディレクトリが空の場合 */ }

  const watcher = fs.watch(dir, (eventType, filename) => {
    if (!filename) return;

    // renameイベントのみ処理（新規ファイル作成を検知）
    // changeイベント（ファイル再生時のatime更新等）は無視
    if (eventType !== 'rename') return;

    const ext = path.extname(filename).toLowerCase();
    if (!extensions.includes(ext)) return;

    // 送信済みファイルは無視（再生等による再検知防止）
    if (sent.has(filename)) return;

    // デバウンス: 同一ファイルの短時間連続イベントを無視
    const now = Date.now();
    const lastSeen = seen.get(filename);
    if (lastSeen && (now - lastSeen) < DEBOUNCE_MS) return;
    seen.set(filename, now);

    const filePath = path.join(dir, filename);

    // ファイルが存在するか確認（削除イベントを除外）
    if (!fs.existsSync(filePath)) return;

    // 送信済みとして記録
    sent.add(filename);

    // ★ #578 callback の失敗 (async の reject を含む) でプロセスを落とさない。
    //   以前は await も catch もせず、本体の再起動中の送信で unhandled rejection になり、監視ごと落ちていた
    Promise.resolve()
      .then(() => onFile(filePath))
      .catch((err) => console.error(`❌ ${path.basename(filePath)} の処理に失敗:`, err instanceof Error ? err.message : String(err)));
  });

  return function stop() {
    watcher.close();
  };
}

/**
 * .last_sent ファイルから最終送信日時を読み取る
 */
export function readLastSent(dir: string): Date | null {
  const filePath = path.join(dir, '.last_sent');
  try {
    if (fs.existsSync(filePath)) {
      return new Date(fs.readFileSync(filePath, 'utf8').trim());
    }
  } catch {}
  return null;
}

/**
 * .last_sent ファイルに最終送信日時を書き込む
 */
export function writeLastSent(dir: string, date: Date): void {
  const filePath = path.join(dir, '.last_sent');
  fs.writeFileSync(filePath, date.toISOString());
}

export interface UnsentFile {
  path: string;
  mtime: number;
}

/**
 * 未送信ファイルを取得（.last_sent 以降のファイル）
 */
export function getUnsent(dir: string, extensions: string[]): UnsentFile[] {
  const lastSent = readLastSent(dir);
  // .last_sent がない場合は catch-up 対象なし（初回は全送信しない）
  if (!lastSent) return [];
  const files: UnsentFile[] = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name === '.last_sent') continue;
      const ext = path.extname(name).toLowerCase();
      if (!extensions.includes(ext)) continue;
      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      // ★ #587 .last_sent はミリ秒までしか持たない (toISOString)。NTFS の mtimeMs は端数を持つので、
      //   切り捨ててから比べる (そうしないと最後に送った録音が「未送信」に見え、起動し直すたびに二重に送った)
      if (Math.floor(stat.mtimeMs) > lastSent.getTime()) {
        files.push({ path: filePath, mtime: stat.mtimeMs });
      }
    }
  } catch {}
  // 古い順にソート
  files.sort((a, b) => a.mtime - b.mtime);
  return files;
}


/** ★ #578 送り直しの待ち時間 (ms)。本体の再起動は数秒なので、最初の数回で届く */
export const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

/**
 * ★ #578 送信を、失敗したら間を空けて送り直す。届いたら true、使い切ったら false。**例外は投げない。**
 * 以前は 1 回で諦め、本体の再起動中 (ECONNREFUSED) に当たるとプロセスごと落ちて 4 時間黙った (10-02)。
 */
export async function sendWithRetry(
  attempt: () => Promise<boolean>,
  delaysMs: number[] = RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  for (let i = 0; ; i += 1) {
    try {
      if (await attempt()) return true;
    } catch (err) {
      console.error(`❌ 送信に失敗 (${i + 1} 回目):`, err instanceof Error ? err.message : String(err));
    }
    if (i >= delaysMs.length) return false;
    console.log(`🔁 ${Math.round(delaysMs[i] / 1000)} 秒後に送り直します`);
    await sleep(delaysMs[i]);
  }
}

/**
 * ★ #582 監視中の送信を 1 本ずつ順番に処理し、送れなかった録音を覚えておく。
 *
 * 以前 (#578) は録音ごとに並行して送り、届くと .last_sent を「今の時刻」にしていた。
 * 録音 A が送り直し中に後の録音 B が届くと .last_sent が A を越え、A は二度と送られなかった
 * (catch-up は mtime > .last_sent しか見ず、プロセスの中でも送信済み扱い)。
 *
 * - 送れなかった録音は、次の録音の前に送り直す (本体が戻っていれば届く)
 * - onAllSent (= .last_sent を進める) は「送れていない録音が 1 本も無いとき」だけ呼ぶ
 * - 送信・記録が例外を投げても列は止まらない
 */
export function createWatchSender({
  send,
  onAllSent,
  retry = sendWithRetry,
}: {
  send: (filePath: string) => Promise<boolean>;
  onAllSent: (lastFilePath: string) => void;
  retry?: (attempt: () => Promise<boolean>) => Promise<boolean>;
}): (filePath: string) => Promise<boolean> {
  const failed: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();

  const run = async (filePath: string): Promise<boolean> => {
    // 先に、送れなかった録音を古い順に送り直す (1 本でも送れなければそこで止める = 本体はまだ戻っていない)
    while (failed.length > 0) {
      const head = failed[0];
      if (!(await retry(() => send(head)))) break;
      console.log(`✅ 送り直せました: ${path.basename(head)}`);
      failed.shift();
    }
    const ok = await retry(() => send(filePath));
    if (!ok) failed.push(filePath);
    if (failed.length === 0) {
      try {
        onAllSent(filePath);
      } catch (err) {
        console.error('❌ 最後に送った時刻を記録できませんでした:', err instanceof Error ? err.message : String(err));
      }
    } else {
      console.error(`⚠️ 送れていない録音が ${failed.length} 本あります (次の録音の前に送り直します。最後に送った時刻は進めません): ${failed.map((f) => path.basename(f)).join(', ')}`);
    }
    return ok;
  };

  return (filePath: string) => {
    const p = chain.then(() => run(filePath)).catch((err) => {
      console.error(`❌ ${path.basename(filePath)} の送信の処理に失敗:`, err instanceof Error ? err.message : String(err));
      return false;
    });
    chain = p;
    return p;
  };
}
