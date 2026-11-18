/**
 * ログの 2 つ目以降の引数を本文につなげる (2026-09-26)。
 *
 * ★ なぜ要るか: `logger.error('...:', statusCode)` の statusCode (数値・文字列) が、
 *   画面では丸ごと、ファイル (JSON 行) でも**黙って消えていた**。
 * ★★ server/src/utils/logFormat.mts と同じ約束 (Error は足さない・本文が空の Error は理由を足す / 1 つ 2000 字まで)。
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

/**
 * ★★ Error だけは足さない —— winston が既に message へ連結している (足すと二重になる)。
 * ★ ただし本文が空の Error (AggregateError) は、winston が空を連結するだけなので、ここで理由を足す
 *   (改善ループ 67、#649 B-1。本体は改善ループ 42 で直していたが、この写しには入っていなかった)
 */
export const appendExtras = format((info) => {
  const splat = (info[SPLAT] as unknown[] | undefined) ?? [];
  const extras = splat.filter((v) => !(v instanceof Error) || !v.message).map((v) => (v instanceof Error ? errorText(v) : extraToString(v)));
  if (extras.length) info.message = `${info.message} ${extras.join(' ')}`;
  return info;
});

/**
 * エラーを 1 行の理由にする (本体の server/src/utils/logFormat.mts と同じ。テストで中身を突き合わせている)。
 * ★ 2026-11-06 の DB 停止で、pg が ::1 と 127.0.0.1 の両方に断られて message が空の AggregateError を投げ、
 *   ログの理由が空になった。空なら中のエラーをつなぎ、それも無ければ名前を返す
 */
export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.message) return err.message;
  const inner = err instanceof AggregateError ? err.errors.map((e) => (e instanceof Error ? e.message || e.name : String(e))).filter(Boolean) : [];
  const code = (err as { code?: unknown }).code;
  if (inner.length) return `${err.name}: ${inner.join(" / ")}`;
  return typeof code === "string" ? `${err.name}: ${code}` : err.name;
}
