/**
 * #589 起動時の初期化 (Bot のログイン) の待ち合わせ。
 *
 * ★ 初期化は、つながるまで試し直す (#581。5s → 15s → 30s → 60s ごと)。その待ちの間に webhook が届いたら、
 *   本体は上がっているということなので、待ちを起こしてすぐ試し直す (kickInitRetry)。
 *   届いた投稿の側は、つながるのを少し待ってから処理する (whenAgentReady)。以前は dispatcher のガードで捨てていた
 * ★ register と handler の両方から使う。register が handler を読むので、ここを別のモジュールにして輪を作らない
 */
let ready = false;
let inProgress = false;
let readyWaiters: Array<() => void> = [];
let wakeSleep: (() => void) | null = null;

export function markAgentReady(): void {
  ready = true;
  for (const resolve of readyWaiters.splice(0)) resolve();
}

export function isAgentReady(): boolean {
  return ready;
}

/** 試し直しが走っている間だけ true。止めた (401) あとや、走らせていないとき (テスト) は待っても来ない */
export function setInitInProgress(value: boolean): void {
  inProgress = value;
}

export function isInitInProgress(): boolean {
  return inProgress;
}

/** 試し直しの待ちを起こす。待っていなければ何もしない */
export function kickInitRetry(): void {
  wakeSleep?.();
}

/** 試し直しの待ち。kickInitRetry で早く終わる。停止 (SIGINT) を待たせない */
export function sleepUnlessKicked(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      if (wakeSleep === done) wakeSleep = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    timer.unref();
    wakeSleep = done;
  });
}

/** つながるのを最大 ms 待つ。つながれば true、時間切れなら false */
export function whenAgentReady(ms: number): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((f) => f !== onReady);
      resolve(false);
    }, ms);
    timer.unref();
    readyWaiters.push(onReady);
  });
}

export function resetInitGateForTest(): void {
  ready = false;
  inProgress = false;
  readyWaiters = [];
  wakeSleep = null;
}
