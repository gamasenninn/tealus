/**
 * ログの timestamp にミリ秒を出す (#359 B-1)
 *
 * ★ なぜ: 切断の突き合わせで測りたいのは Δ (本体サーバの proxy が閉じた時刻 と
 *   agent-server が `subscriber removed` を書いた時刻の差)。秒に丸めると
 *   **測りたい量そのものが分解能より小さくなる**。
 *
 * ★★ このテストが守っているのは書式そのものではなく、**下流の parser との約束**:
 *   見張り (report/tools/cc_stream_unexpected.py) は `ts[:10]` を日付、
 *   `ts[11:]` を時刻として読む。ミリ秒を足しても、この 2 つの切り出しは変わらない。
 *   ★★★ 桁を足すときに位置がずれると、見張りが黙って別の日の行を数える。
 */
import { createLogger, format, transports } from 'winston';
import Transport from 'winston-transport';
import { LOG_TIMESTAMP_FORMAT } from '../../src/lib/logger.mts';

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

describe('LOG_TIMESTAMP_FORMAT', () => {
  test('ミリ秒 3 桁まで出る', () => {
    expect(emitOne()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  test('★ ts[:10] は日付のまま (見張りの日付判定が壊れない)', () => {
    expect(emitOne().slice(0, 10)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('★ ts[11:] は時刻のまま (見張りの秒換算が壊れない)', () => {
    expect(emitOne().slice(11)).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});
