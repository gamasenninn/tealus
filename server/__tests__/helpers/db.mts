/**
 * Test database helper
 * Provides setup/teardown for test database.
 */
import { Pool, type PoolClient } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

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
  const client: PoolClient = await p.connect();
  try {
    // Drop all tables first (clean slate)
    await client.query(`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    // Run migrations
    const migrationsDir = path.join(import.meta.dirname, '../../src/db/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
    }
  } finally {
    client.release();
  }
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
