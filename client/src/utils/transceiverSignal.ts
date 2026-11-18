/** 返事を待つ手 (合えば true を返し、外される) */
export type SignalHandler<M> = (msg: M) => boolean;

/** rtc-server の返事を待つ時間の既定 (ミリ秒) */
export const SIGNAL_TIMEOUT_MS = 15_000;

/**
 * トランシーバーの返事待ち (改善ループ 65、#649 A-3)。predicate に合う便が来たら解決し、
 * timeoutMs までに来なければ失敗にする。どちらでも待ち手 (handlers の 1 つ) を外す。
 * ★ 以前は時間切れが無く、rtc-server が返事をしないと「接続中」のまま止まり、やり直しもできなかった
 */
export function waitForSignal<M, T extends M = M>(
  handlers: SignalHandler<M>[], predicate: (msg: M) => boolean, timeoutMs = SIGNAL_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const remove = () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
    const timer = setTimeout(() => {
      remove();
      reject(new Error('トランシーバーの相手 (rtc-server) が応答しません'));
    }, timeoutMs);
    const handler: SignalHandler<M> = (msg) => {
      if (!predicate(msg)) return false;
      clearTimeout(timer);
      remove();
      resolve(msg as T);
      return true;
    };
    handlers.push(handler);
  });
}
