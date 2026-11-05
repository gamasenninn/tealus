/**
 * 読み込みの繰り返しに気づく (改善ループ 41)。
 *
 * ★ 2026-11-04 10〜13 時、Mac の 1 台 (Safari の Dock のアプリ) が開いては数十ミリ秒で消されるのを 3 時間繰り返し、
 *   本体へ約 11 万回の要求を送った。Tealus の画面に自分で読み込み直す道は無く、原因は端末の側 (推測)。
 *   起動の時刻を localStorage に残し (消されても残る)、30 秒に上限を超えたら main.tsx が本体を叩かずに止まる
 * ★ 保存領域が使えない端末では数えない (起動はする)
 */
export const BOOT_LOOP_LIMIT = 10;
const WINDOW_MS = 30_000;
const KEY = 'tealusBootTimes';

export function recordBoot(storage: Storage, now = Date.now()): { looping: boolean; count: number } {
  try {
    const prev = JSON.parse(storage.getItem(KEY) || '[]') as unknown;
    const recent = (Array.isArray(prev) ? prev : [])
      .filter((t): t is number => typeof t === 'number' && now - t >= 0 && now - t < WINDOW_MS);
    recent.push(now);
    storage.setItem(KEY, JSON.stringify(recent.slice(-(BOOT_LOOP_LIMIT * 2))));
    return { looping: recent.length > BOOT_LOOP_LIMIT, count: recent.length };
  } catch {
    return { looping: false, count: 0 };
  }
}

/** 「このまま開く」を押したとき。数え直して、次の起動は止めない */
export function forgetBoots(storage: Storage): void {
  try { storage.removeItem(KEY); } catch { /* 数えないだけ */ }
}
