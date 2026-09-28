/**
 * Test database helper
 * Provides setup/teardown for test database.
 */
import { Pool } from 'pg';
import { migrate } from '../../src/db/migrate.mts';

let pool: Pool | null = null;

/**
 * Get or create the test database pool
 */
export function getTestPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5433'),
      database: process.env.DB_NAME || 'tealus_test',
      user: process.env.DB_USER || 'tealus_test',
      password: process.env.DB_PASSWORD || 'tealus_test',
    });
  }
  return pool;
}

/**
 * Run migrations on the test database
 */
export async function setupTestDb(): Promise<void> {
  const p = getTestPool();
  // Drop all tables first (clean slate)
  await p.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  // ★ #406: 本番と同じ runner を使う。以前はここに「全ファイルを流す」処理を
  //   **もう 1 つ持っていた** ので、台帳も再生の経路もテストで一度も通らなかった。
  //   同じ仕事のコードを 2 か所に持つと、片方だけが壊れていても気づけない。
  await migrate({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433'),
    database: process.env.DB_NAME || 'tealus_test',
    user: process.env.DB_USER || 'tealus_test',
    password: process.env.DB_PASSWORD || 'tealus_test',
  }, { log: () => {} });
}

/**
 * Clean all data from tables (preserve schema)
 */
export async function cleanTestDb(): Promise<void> {
  const p = getTestPool();
  await p.query(`
    TRUNCATE TABLE
      user_stamp_usage,
      stamps,
      stamp_packs,
      message_tags,
      tags,
      message_reactions,
      link_previews,
      voice_transcriptions,
      push_subscriptions,
      room_read_cursors,
      message_media,
      messages,
      room_members,
      rooms,
      users
    CASCADE;
  `);
}

/**
 * Close the test database pool
 */
export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * 音声を上げた直後に裏で走る文字起こしが、状態を書き終えるまで待つ
 * (テストのダミー音声では 'error' で終わる)。
 * ★ 固定時間の待ちにしないこと。裏の 'error' がテストの書いた 'done' より後に届くと上書きされる
 *   (待ちを 0 にすると 2 回に 1 回落ちた。単独なら約 80ms で終わるので 500ms 待ちでは実際には出ていない)
 */
export async function waitTranscriptionSettled(messageId: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await getTestPool().query('SELECT status FROM voice_transcriptions WHERE message_id = $1', [messageId]);
    const status = r.rows[0]?.status;
    if (status === 'error' || status === 'done') return;
    if (Date.now() > deadline) throw new Error(`文字起こしが終わらない (status=${status})`);
    await new Promise(res => setTimeout(res, 20));
  }
}
