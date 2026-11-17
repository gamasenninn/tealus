import type { Request } from 'express';

/**
 * 1 つの相手が同じ口を 1 分に何十回も叩いたことを、warn に 1 行で知らせる (改善ループ 41)。
 *
 * ★ 2026-11-04 10〜13 時、1 台の端末 (Safari の Dock のアプリ) が読み込みを繰り返し、本体へ 3 時間で約 11 万回
 *   (GET /api/config 最大 652 回/分)。全部 debug 行だったので、ログを数えるまで誰も気づかなかった。
 * ★ 止めない (429 にしない)。まず見えるようにする。閾値は他の日の最大 27 回/分 (ビルド直後の一斉の読み込み) の倍より上
 * ★ 数えるのは本体のメモリだけ (docs/03 の流儀)。再起動で消えてよい
 */
const LIMIT_PER_MINUTE = 60;
const REPORT_EVERY_MS = 10 * 60_000;
const WINDOW_MS = 60_000;

/** 1 つの窓で覚える違う URL の数の上限 (相手ごとにメモリが増え続けないように) */
const DISTINCT_CAP = 200;

const windows = new Map<string, { start: number; count: number; urls: Set<string> }>();
const lastReported = new Map<string, number>();

export function resetRequestFlood(): void { windows.clear(); lastReported.clear(); }

/** 誰として数えるか。★ ログインしていない口は Cloudflare が付ける元の IP (req.ip は中継の IP になり、外の全員が 1 つに束なる) */
export function floodKey(req: Request): string {
  if (req.user?.id) return `user=${req.user.id.slice(0, 8)}`;
  const cf = typeof req.get === 'function' ? req.get('cf-connecting-ip') : undefined;
  return `ip=${cf || req.ip || '-'}`;
}

/** 部屋ごとの口は ID をまとめる (部屋を開き直す繰り返しも 1 つの口として数える) */
function routeOf(methodAndPath: string): string {
  return methodAndPath.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}

/**
 * 1 回の要求を数える。閾値を超えた瞬間 (10 分に 1 回まで) だけ、warn に書く 1 行を返す
 *
 * ★ `url` (問い合わせの ? 以降も含む) は、1 分の中の「違う URL の数」を数えるためだけに覚える (ログには書かない)。
 *   同じ URL の繰り返し (端末の暴走) と、違う URL を順に読むまとめての読み込み (画像の取り込みのスクリプトなど) を
 *   1 行で見分けるため (改善ループ 60)。渡さなければ口そのものを 1 つの URL として数える
 */
export function noteRequestForFlood(
  key: string, methodAndPath: string, now = Date.now(), url = methodAndPath, distinctCap = DISTINCT_CAP,
): string | null {
  const route = routeOf(methodAndPath);
  const k = `${key} ${route}`;
  let w = windows.get(k);
  if (!w || now - w.start >= WINDOW_MS) {
    w = { start: now, count: 0, urls: new Set() };
    windows.set(k, w);
  }
  w.count++;
  if (w.urls.size < distinctCap) w.urls.add(url);
  if (w.count <= LIMIT_PER_MINUTE) return null;
  const last = lastReported.get(k);
  if (last !== undefined && now - last < REPORT_EVERY_MS) return null;
  lastReported.set(k, now);
  // ★ 古い窓を掃除する (相手ごとに増え続けないように)。報告のときだけなので重くない
  for (const [kk, ww] of windows) if (now - ww.start >= WINDOW_MS) windows.delete(kk);
  const distinct = w.urls.size >= distinctCap ? `${distinctCap} 件以上` : `${w.urls.size} 件`;
  // ★ 半分より多くが違う URL なら、同じものを叩き直しているのではない
  const hint = w.urls.size * 2 > w.count
    ? 'ほとんどが違う URL: 画像の取り込みなど、まとめての読み込みの疑い'
    : '同じ URL の繰り返し: 端末の読み込みの繰り返し・スクリプトの連打の疑い';
  return `[http-flood] ${route} が 1 分に ${LIMIT_PER_MINUTE} 回を超えました ${key} 違う URL ${distinct} (${hint}。次の知らせは 10 分後)`;
}
