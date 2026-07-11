import { createLogger, format, transports } from 'winston';
import 'winston-daily-rotate-file';
import path from 'node:path';

export const logger = createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
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
