/**
 * この窓を人が使っているか (2026-11-23 小野さん「トークが開かれていても操作がされていないものには未読をつける」)。
 *
 * #474 で「画面に出ている (タブが裏でない・最小化していない)」ときだけ既読にした。それでも、
 * 2 枚目の画面に出しっぱなしの PC や、別の窓で作業している間の PC は、見ていないのに既読をつけ、
 * 「見ている」(#475) を出してスマホへの通知も止めていた。
 *
 *   使っている = 画面に出ている かつ 窓が選ばれている かつ 最後の操作から IDLE_MS 以内
 *
 * ★ マルチトークのパネル (同じ Tealus の中の iframe) は親の窓でまとめて判定する。
 *   パネルごとに「選ばれているか」を見ると、隣のパネルで書いている間、見えている部屋が全部未読になる。
 *   親の document.hasFocus() は中の iframe が選ばれていても true になる。最後の操作の時刻も親の窓に置いて分け合う。
 * ★ スクロールは操作に数えない。新着でいちばん下へ合わせる (プログラムが動かす) と、それで「使っている」に戻ってしまう。
 *   人のスクロールはホイール・タッチ・キーで拾う。
 */
import { isEmbeddedInSameApp } from '../utils/embedded';

export const IDLE_MS = 3 * 60 * 1000;
/** 操作を知らせる回数を抑える (マウスを動かすたびに全パネルが判定し直さないように) */
const INPUT_THROTTLE_MS = 1000;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove'] as const;
const SIGNAL = 'tealus:attention-input';

interface Shared { lastInput: number; lastSignal: number }
type HostWindow = Window & { __tealusAttention?: Shared };

function host(): HostWindow {
  return (isEmbeddedInSameApp() ? window.top : window) as HostWindow;
}

function shared(): Shared {
  const h = host();
  if (!h.__tealusAttention) h.__tealusAttention = { lastInput: Date.now(), lastSignal: 0 };
  return h.__tealusAttention;
}

function focused(): boolean {
  try {
    return host().document.hasFocus();
  } catch {
    return document.hasFocus();
  }
}

/** いま、この窓を人が使っているか */
export function isAttending(now: number = Date.now()): boolean {
  if (document.visibilityState !== 'visible') return false;
  if (!focused()) return false;
  return now - shared().lastInput < IDLE_MS;
}

/** 人の操作があったことを記録する (テストと、入力の受け口から呼ぶ) */
export function noteInput(now: number = Date.now()): void {
  const s = shared();
  s.lastInput = now;
  if (now - s.lastSignal < INPUT_THROTTLE_MS) return;
  s.lastSignal = now;
  host().dispatchEvent(new Event(SIGNAL));
}

/**
 * 使っている / 使っていないが変わったら cb を呼ぶ。戻り値で止める。
 * ★ 使っていない側へは操作が止まって IDLE_MS 経ったときに、使っている側へは操作・窓の選択・表に出たときにすぐ変わる。
 */
export function onAttentionChange(cb: (attending: boolean) => void): () => void {
  let last = isAttending();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let soon: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const check = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = undefined;
    const now = Date.now();
    const attending = isAttending(now);
    // 使っている間だけ、操作が止まったときに判定し直す時計を置く (使っていない間は操作・選択・表示の知らせで起きる)
    if (attending) timer = setTimeout(check, Math.max(1000, shared().lastInput + IDLE_MS - now));
    if (attending !== last) {
      last = attending;
      cb(attending);
    }
  };
  // ★ 親の窓の blur は、中の iframe へ選択が移ったときにも出る。移った先が決まってから見る
  const checkSoon = () => { clearTimeout(soon); soon = setTimeout(check, 0); };
  const onInput = () => noteInput();

  const h = host();
  for (const ev of INPUT_EVENTS) document.addEventListener(ev, onInput, { capture: true, passive: true });
  document.addEventListener('visibilitychange', check);
  h.addEventListener(SIGNAL, check);
  h.addEventListener('focus', check);
  h.addEventListener('blur', checkSoon);
  if (h !== window) {
    window.addEventListener('focus', check);
    window.addEventListener('blur', checkSoon);
  }
  if (last) timer = setTimeout(check, Math.max(1000, shared().lastInput + IDLE_MS - Date.now()));

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(soon);
    for (const ev of INPUT_EVENTS) document.removeEventListener(ev, onInput, { capture: true });
    document.removeEventListener('visibilitychange', check);
    h.removeEventListener(SIGNAL, check);
    h.removeEventListener('focus', check);
    h.removeEventListener('blur', checkSoon);
    if (h !== window) {
      window.removeEventListener('focus', check);
      window.removeEventListener('blur', checkSoon);
    }
  };
}
