/**
 * 本体サーバのログ timestamp にもミリ秒を出す (#359 B-1)
 *
 * ★ agent-server 側と**同じ値**でなければ意味がない。片方だけ丸まっていると、
 *   proxy の切断行と `subscriber removed` の Δ が、その丸めのぶんだけ嘘になる。
 *   別パッケージなので定数を import できず、両方に同じテストを置いて揃えている。
 */
import { createLogger, format } from 'winston';
import Transport from 'winston-transport';
import { LOG_TIMESTAMP_FORMAT } from '../../src/utils/logger.mts';

class Capture extends Transport {
  lines: string[] = [];
  override log(info: { timestamp?: string }, next: () => void): void {
    this.lines.push(String(info.timestamp));
    next();
  }
}

function emitOne(): string {
  const capture = new Capture();
  const logger = createLogger({
    level: 'info',
    format: format.combine(format.timestamp({ format: LOG_TIMESTAMP_FORMAT }), format.json()),
    transports: [capture],
  });
  logger.info('probe');
  return capture.lines[0];
}

describe('LOG_TIMESTAMP_FORMAT (本体サーバ)', () => {
  test('ミリ秒 3 桁まで出る', () => {
    expect(emitOne()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  test('★ agent-server と同じ書式であること (Δ が測れる前提)', () => {
    expect(LOG_TIMESTAMP_FORMAT).toBe('YYYY-MM-DD HH:mm:ss.SSS');
  });
});
