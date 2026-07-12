/**
 * Agent Server ロガー
 * Console + 日次ファイルローテーション
 */
import path from 'node:path';
import { createLogger, format, transports } from 'winston';
import 'winston-daily-rotate-file';

const LOG_DIR = path.join(import.meta.dirname, '..', '..', 'logs');

// Console 用フォーマット（人間が読みやすい）
const consoleFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message }) =>
    `${timestamp} [${level}] [Agent] ${message}`
  )
);

// ファイル用フォーマット（JSON 行、API でパースしやすい）
const fileFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.json()
);

export const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  transports: [
    new transports.Console({ format: consoleFormat }),
    new transports.DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'agent-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      format: fileFormat,
    }),
  ],
});
