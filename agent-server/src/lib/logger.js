/**
 * Agent Server ロガー
 */
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message }) =>
      `${timestamp} [${level}] [Agent] ${message}`
    )
  ),
  transports: [
    new transports.Console(),
  ],
});

module.exports = logger;
