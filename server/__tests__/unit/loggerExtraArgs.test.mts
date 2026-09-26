/**
 * ログの 2 つ目以降の引数が捨てられない (2026-09-26)
 *
 * ★ なぜ要るか: printf が `message` しか見ていなかったので、
 *   `logger.error('Push failed for ...:', statusCode)` の statusCode (数値) が
 *   **黙って消えていた**。★★ 本番ログに「Push failed for <endpoint>:」が 1 日 50 件前後
 *   並んでいたのに、**なぜ失敗したかが 1 件も残っていなかった**。
 *   ★ 同じ書き方 (2 つ目以降に理由を渡す) は本体に 100 か所以上ある。
 *
 * ★★ 実測 (直す前の printf):
 *   数値 / 文字列 / オブジェクト / 3 つ目以降  → ★ 消える
 *   Error                                  → winston が message に連結する (★ ここは消えない)
 *   → ★★★ Error をもう一度足すと二重になるので、Error だけは足さない
 */
import { createLogger, format } from 'winston';
import Transport from 'winston-transport';
import { formatLine, EXTRA_MAX_CHARS } from '../../src/utils/logFormat.mts';

class Capture extends Transport {
  lines: string[] = [];
  override log(info: Record<string | symbol, unknown>, next: () => void): void {
    this.lines.push(String(info[Symbol.for('message')]));
    next();
  }
}

function emit(...args: unknown[]): string {
  const capture = new Capture();
  const logger = createLogger({
    level: 'debug',
    format: format.combine(format.timestamp(), format.errors({ stack: true }), format.printf(formatLine)),
    transports: [capture],
  });
  (logger.error as (...a: unknown[]) => void)(...args);
  // ★ 時刻は比べない (揺れるので)。`[level] 本文` 以降だけを見る
  return capture.lines[0].replace(/^\S+ \[error\] /, '');
}

describe('logger: 2 つ目以降の引数', () => {
  test('★ 数値が残る (Push failed の statusCode)', () => {
    expect(emit('Push failed for https://example/x:', 403)).toBe('Push failed for https://example/x: 403');
  });

  test('文字列が残る', () => {
    expect(emit('webpush:', 'BadJwtToken')).toBe('webpush: BadJwtToken');
  });

  test('オブジェクトは JSON で残る', () => {
    expect(emit('status:', { statusCode: 410, body: 'gone' })).toBe('status: {"statusCode":410,"body":"gone"}');
  });

  test('3 つ目以降も残る', () => {
    expect(emit('two:', 'a', 'b')).toBe('two: a b');
  });

  test('★ Error は二重にならない (winston が既に message へ連結している)', () => {
    expect(emit('dispatch:', new Error('connect ECONNREFUSED'))).toBe('dispatch: connect ECONNREFUSED');
  });

  test('引数が 1 つなら今までと同じ', () => {
    expect(emit('probe')).toBe('probe');
  });

  test('★ 長すぎる値は切る (1 つの値で数万字になることがある)', () => {
    const out = emit('big:', 'x'.repeat(EXTRA_MAX_CHARS * 3));
    expect(out.length).toBeLessThan(EXTRA_MAX_CHARS + 100);
    expect(out).toContain('…(');
  });
});
