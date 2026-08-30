/**
 * Agent Server ロガー
 * Console + 日次ファイルローテーション
 */
import path from 'node:path';
import { createLogger, format, transports } from 'winston';
import 'winston-daily-rotate-file';

const LOG_DIR = path.join(import.meta.dirname, '..', '..', 'logs');

/**
 * ★ ミリ秒まで出す (#359 B-1)。
 *
 * 秒に丸めると、切断の突き合わせで測りたい Δ (本体サーバの proxy が閉じた時刻 と
 * ここで `subscriber removed` を書いた時刻の差) が分解能より小さくなって測れない。
 *
 * ★★ 桁は**後ろに足すだけ**。見張り (report/tools/cc_stream_unexpected.py) は
 *   `ts[:10]` を日付、`ts[11:]` を時刻として切り出しており、位置がずれると
 *   **黙って別の日の行を数える**。__tests__/unit/loggerTimestamp.test.mts で固定している。
 */
export const LOG_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH:mm:ss.SSS';

// Console 用フォーマット（人間が読みやすい）
const consoleFormat = format.combine(
  format.timestamp({ format: LOG_TIMESTAMP_FORMAT }),
  format.printf(({ timestamp, level, message }) =>
    `${timestamp} [${level}] [Agent] ${message}`
  )
);

// ファイル用フォーマット（JSON 行、API でパースしやすい）
const fileFormat = format.combine(
  format.timestamp({ format: LOG_TIMESTAMP_FORMAT }),
  format.json()
);

/**
 * ★ テスト中はファイルへ書かない。
 *
 * logger は NODE_ENV に関係なく本番の `logs/agent-%DATE%.log` へ張っていたので、
 * `npm test` を流すとテストの出力が**運用ログに混ざる**。
 * 2026-08-30 実測で 40 行混入し、`[delegator] target agent error in B: boom`
 * のような**フィクスチャが本番の障害に見える**行が残った。
 *
 * Console は残す (テスト出力では今までどおり見えてよい。消えるのはファイルだけ)。
 * JEST_WORKER_ID も見るのは、NODE_ENV を明示せずに jest を叩かれても効かせるため。
 */
const IS_TEST = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

const fileTransports = IS_TEST ? [] : [
  new transports.DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'agent-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '30d',
    format: fileFormat,
  }),
];

export const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  transports: [
    new transports.Console({ format: consoleFormat }),
    ...fileTransports,
  ],
});
