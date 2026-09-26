/**
 * ログの 2 つ目以降の引数が捨てられない (2026-09-26、server/__tests__/unit/loggerExtraArgs.test.mts と同じ約束)
 *
 * ★ 実測 (直す前): 画面は message しか出さず、ファイル (JSON 行) も
 *   **数値と文字列が消えていた** (オブジェクトは項目に、Error は message と stack に残る)。
 * ★★ 別パッケージなので server の部品は import しない (越境 import は CI で落ちる、2026-09-24)。
 *   同じ約束を両方のテストで固定する。
 */
import { createLogger, format } from 'winston';
import Transport from 'winston-transport';
import { appendExtras, EXTRA_MAX_CHARS } from '../../src/lib/logFormat.mts';

class Capture extends Transport {
  infos: Record<string | symbol, unknown>[] = [];
  override log(info: Record<string | symbol, unknown>, next: () => void): void {
    this.infos.push(info);
    next();
  }
}

function emit(...args: unknown[]): { message: string; json: Record<string, unknown> } {
  const capture = new Capture();
  const logger = createLogger({ level: 'debug', format: format.combine(appendExtras(), format.json()), transports: [capture] });
  (logger.error as (...a: unknown[]) => void)(...args);
  const info = capture.infos[0];
  return { message: String(info.message), json: JSON.parse(String(info[Symbol.for('message')])) };
}

describe('agent-server logger: 2 つ目以降の引数', () => {
  test('★ 数値が残る', () => {
    expect(emit('status:', 403).message).toBe('status: 403');
  });
  test('★ ファイル (JSON 行) にも残る', () => {
    expect(emit('status:', 403).json.message).toBe('status: 403');
  });
  test('文字列が残る', () => {
    expect(emit('reason:', 'BadJwtToken').message).toBe('reason: BadJwtToken');
  });
  test('オブジェクトは JSON で残る', () => {
    expect(emit('obj:', { statusCode: 410 }).message).toBe('obj: {"statusCode":410}');
  });
  test('3 つ目以降も残る', () => {
    expect(emit('two:', 'a', 'b').message).toBe('two: a b');
  });
  test('★ Error は二重にならない', () => {
    expect(emit('dispatch:', new Error('boom')).message).toBe('dispatch: boom');
  });
  test('引数が 1 つなら今までと同じ', () => {
    expect(emit('probe').message).toBe('probe');
  });
  test('★ 長すぎる値は切る', () => {
    const m = emit('big:', 'x'.repeat(EXTRA_MAX_CHARS * 3)).message;
    expect(m.length).toBeLessThan(EXTRA_MAX_CHARS + 100);
    expect(m).toContain('…(');
  });
  test('★ 出力先が 2 つ (画面 + ファイル) でも二重にならない', () => {
    // ★ logger.mts は画面用とファイル用の両方の format に appendExtras を入れている。
    //   winston が出力先ごとに info を複製するので二重にならない (2026-09-26 実測)。崩れたらここで落ちる
    const a = new Capture({ format: format.combine(appendExtras(), format.json()) });
    const b = new Capture({ format: format.combine(appendExtras(), format.json()) });
    createLogger({ level: 'debug', transports: [a, b] }).error('status:', 403);
    expect([a.infos[0].message, b.infos[0].message]).toEqual(['status: 403', 'status: 403']);
  });
});
