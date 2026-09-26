/**
 * ログ 1 行の組み立て (2026-09-26)。★ logger.mts から分けてある理由:
 *   テストでは logger.mts がモジュールごと差し替えられる (jest.setupAfterEnv.js、本番ログに書かないため)。
 *   組み立てを同じファイルに置くとテストから届かないので、出力先を持たないここに置く。
 */
/** ★ 2 つ目以降の引数 1 つあたりの上限 (kill 由来のエラーは 1 つで 16 万字になったことがある) */
export const EXTRA_MAX_CHARS = 2000;

const SPLAT = Symbol.for('splat');

function extraToString(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'object' && v !== null) {
    try { s = JSON.stringify(v); } catch { s = String(v); }
  } else s = String(v);
  return s.length > EXTRA_MAX_CHARS ? `${s.slice(0, EXTRA_MAX_CHARS)}…(${s.length} 字)` : s;
}

/**
 * ログ 1 行を組み立てる。★ 2026-09-26: 2 つ目以降の引数を捨てない。
 *
 * ★ 以前の printf は `message` しか見ていなかったので、
 *   `logger.error('Push failed for ...:', statusCode)` の statusCode (数値) が**黙って消えていた**
 *   (本番に「Push failed for ...:」が 1 日 50 件前後、理由 0 件)。同じ書き方が 100 か所以上ある。
 * ★★ Error だけは足さない —— winston が既に message へ連結している (足すと二重になる)。
 */
export function formatLine(info: { timestamp?: unknown; level: string; message: unknown; [k: string | symbol]: unknown }): string {
  const splat = (info[SPLAT] as unknown[] | undefined) ?? [];
  const extras = splat.filter((v) => !(v instanceof Error)).map(extraToString);
  const tail = extras.length ? ` ${extras.join(' ')}` : '';
  return `${info.timestamp} [${info.level}] ${info.message}${tail}`;
}
