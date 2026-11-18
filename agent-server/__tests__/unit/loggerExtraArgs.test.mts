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
import fs from 'node:fs';
import path from 'node:path';
import { appendExtras, EXTRA_MAX_CHARS, errorText } from '../../src/lib/logFormat.mts';

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

/**
 * ★ 本文が空のエラーにも理由を足す (改善ループ 67、#649 B-1)。本体は 11-08 (改善ループ 42) に直したが、
 *   agent-server の写しには入っていなかった。agent-server も DB を使うので、DB が止まると理由が空の行になる
 */
describe('agent-server logger: 本文が空のエラー', () => {
  test('★ AggregateError (本文が空) は中のエラーの理由を足す', () => {
    const err = new AggregateError([new Error('connect ECONNREFUSED ::1:5432'), new Error('connect ECONNREFUSED 127.0.0.1:5432')], '');
    const { message } = emit('DB error:', err);
    expect(message).toContain('ECONNREFUSED ::1:5432');
    expect(message).toContain('127.0.0.1:5432');
  });

  test('本文のあるエラーは足さない (winston が既に本文へつないでいる。二重にしない)', () => {
    const { message } = emit('failed:', new Error('boom'));
    expect(message.split('boom').length - 1).toBeLessThanOrEqual(1);
  });

  test('errorText: 本文があれば本文、空なら中身、中身も無ければ code か名前', () => {
    expect(errorText(new Error('x'))).toBe('x');
    expect(errorText(Object.assign(new Error(''), { code: 'ECONNRESET' }))).toBe('Error: ECONNRESET');
    expect(errorText('s')).toBe('s');
  });
});

/**
 * ★ 本体と agent-server の写しが同じであることを固定する (片方だけ直す型を止める、#649 B-1)。
 *   別パッケージなので import はしない。ファイルを文字として読んで、関数の中身を比べる
 */
describe('本体と agent-server の logFormat の写し', () => {
  test('★ extraToString と errorText の中身が同じ', () => {
    const here = import.meta.dirname;
    const a = fs.readFileSync(path.join(here, '../../src/lib/logFormat.mts'), 'utf8');
    const b = fs.readFileSync(path.join(here, '../../../server/src/utils/logFormat.mts'), 'utf8');
    const body = (raw: string, name: string) => {
      const src = raw.split(String.fromCharCode(13)).join('');   // ★ 改行の形 (CRLF / LF) はファイルごとに違う
      const start = src.indexOf(`function ${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = src.indexOf('\n}\n', start);
      return src.slice(start, end).replace(/\r/g, '').replace(/"/g, "'");
    };
    for (const name of ['extraToString', 'errorText']) expect(body(a, name)).toBe(body(b, name));
  });
});
