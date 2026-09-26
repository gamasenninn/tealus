/**
 * ログの 2 つ目以降の引数を本文につなげる (2026-09-26)。
 *
 * ★ なぜ要るか: `logger.error('...:', statusCode)` の statusCode (数値・文字列) が、
 *   画面では丸ごと、ファイル (JSON 行) でも**黙って消えていた**。
 * ★★ server/src/utils/logFormat.mts と同じ約束 (Error は足さない / 1 つ 2000 字まで)。
 *   別パッケージなので import せず、両方に同じテストを置く。
 */
import { format } from 'winston';

/** ★ 1 つあたりの上限 (kill 由来のエラーは 1 つで 16 万字になったことがある) */
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

/** ★★ Error だけは足さない —— winston が既に message へ連結している (足すと二重になる) */
export const appendExtras = format((info) => {
  const splat = (info[SPLAT] as unknown[] | undefined) ?? [];
  const extras = splat.filter((v) => !(v instanceof Error)).map(extraToString);
  if (extras.length) info.message = `${info.message} ${extras.join(' ')}`;
  return info;
});
