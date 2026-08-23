import { createLogger, format, transports } from 'winston';
import 'winston-daily-rotate-file';
import path from 'node:path';

/**
 * ★ ミリ秒まで出す (#359 B-1)。agent-server 側と揃える —— 揃っていないと
 *   proxy の切断行と `subscriber removed` の Δ が、片方の丸めのぶんだけ嘘になる。
 *   (agent-server/src/lib/logger.mts の LOG_TIMESTAMP_FORMAT と同じ値。
 *    別パッケージなので import せず、両方に同じテストを置いている)
 */
export const LOG_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH:mm:ss.SSS';

export const logger = createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: format.combine(
    format.timestamp({ format: LOG_TIMESTAMP_FORMAT }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}] ${message}`;
    })
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level}] ${message}`;
        })
      ),
    }),
    new transports.DailyRotateFile({
      dirname: path.join(import.meta.dirname, '../../logs'),
      filename: 'tealus-server-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
    }),
  ],
});
