import pg from 'pg';
import { logger } from '../utils/logger.mts';

export const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'tealus',
  user: process.env.DB_USER || 'tealus',
  password: process.env.DB_PASSWORD || 'tealus_dev',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ★ 待機中の接続が切られたとき (DB の再起動など) の知らせを受け止める (2026-09-28)。
//   受け止める処理が無いと「処理されなかった例外」になる。切れた接続は束から外れ、次の要求で張り直される
pool.on('error', (err) => {
  logger.warn(`[db] 待機中の接続が切れました (次の要求で張り直します): ${err.message}`);
});
