/**
 * #445 (2026-09-18) 共有ファイルの **2 本目の受け口**。
 *
 * ## ★★★★★ なぜ要るか
 *
 * ★ 09-17 から「共有すると画面は開くがファイルが入らない」。★★ 端末で点呼を取ったところ:
 *
 * ```
 * [sw-handled] field: []   ← ★★★★ POST は来ているが、フォームが **完全に空**
 * ```
 * ★ media どころか title も text も来ていない。★★ **Chrome 153 で壊れ、141 では同じ
 *   manifest・同じ SW・同じビルドで通る。**
 *
 * ★★★ `LaunchParams.files` は「**POST で launch navigation に渡されたファイル**を
 *   `FileSystemHandle` として返す」と定義されている。★ そこに載っている可能性がある。
 *
 * → ★★★★ **SW 経路は残したまま、受け口を 1 本 足す。** ★ 141 側の挙動は変わらない。
 *
 * ## ★★ 早く登録する必要がある
 *
 * ★ consumer は **launch のときに 1 回だけ**呼ばれる。★★ `/share` の画面が mount してから
 *   登録すると取り逃がすので、**アプリの入口で登録して受け取ったものを持っておく**。
 *   ★★★ 画面は後から取りに来る (`takeLaunchFiles`) か、購読する (`onLaunchFiles`)。
 *
 * ## ★ 「見ていない」と「0 件」を分ける
 *
 * ★★ `checked` を持つ。★★★ 初期化していない状態を「0 件」と読ませない
 *   (= 今週ずっと踏んでいる「沈黙が 2 つの意味を持つ」の予防)。
 */

interface FileSystemFileHandleLike {
  getFile: () => Promise<File>;
}

interface LaunchParamsLike {
  files?: unknown[];
}

interface LaunchQueueLike {
  setConsumer: (consumer: (params: LaunchParamsLike) => void | Promise<void>) => void;
}

type Listener = (files: File[]) => void;

let checked = false;
let supported = false;
/** ★ 取り出すと空になる (画面が消費する) */
let pending: File[] = [];
/** ★ 取り出しても残る。★★ 点呼に「何件来たか」を出すため */
let receivedCount = 0;
const listeners = new Set<Listener>();

function hasGetFile(h: unknown): h is FileSystemFileHandleLike {
  return Boolean(h) && typeof (h as FileSystemFileHandleLike).getFile === 'function';
}

/** アプリの入口で 1 回呼ぶ。★ launch のときに届くファイルを受け取れるようにする。 */
export function initLaunchFiles(): void {
  checked = true;
  const q = (window as unknown as { launchQueue?: LaunchQueueLike }).launchQueue;
  if (!q || typeof q.setConsumer !== 'function') {
    supported = false;
    return;
  }
  supported = true;
  q.setConsumer(async (params) => {
    const handles = Array.isArray(params?.files) ? params.files : [];
    const files: File[] = [];
    for (const h of handles) {
      try {
        if (hasGetFile(h)) files.push(await h.getFile());
        else if (h instanceof File) files.push(h);
      } catch (err) {
        // ★ 1 件失敗しても残りは拾う (★★ 全部落とすと「0 件」になって原因が消える)
        console.warn('[launch] ファイルを開けませんでした:', err);
      }
    }
    if (files.length > 0) {
      pending = files;
      receivedCount = files.length;
      listeners.forEach((l) => l(files));
    }
  });
}

export interface LaunchState {
  /** ★ 初期化したか。★★ false = 見ていない (「0 件」ではない) */
  checked: boolean;
  /** ★ この環境に launchQueue があるか */
  supported: boolean;
  /** ★ 受け取った件数。★★ 取り出しても減らない */
  fileCount: number;
}

export function getLaunchState(): LaunchState {
  return { checked, supported, fileCount: receivedCount };
}

/** 受け取ったファイルを取り出す。★ 二度は取れない (★★ 画面の再描画で二重送信しないため)。 */
export function takeLaunchFiles(): File[] {
  const files = pending;
  pending = [];
  return files;
}

/** 後から mount する画面向け。★ 解除関数を返す。 */
export function onLaunchFiles(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
