/**
 * Test database helper
 * Provides setup/teardown for test database.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool;

/**
 * Get or create the test database pool
 */
function getTestPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5433'),
      database: process.env.DB_NAME || 'linny_test',
      user: process.env.DB_USER || 'linny_test',
      password: process.env.DB_PASSWORD || 'linny_test',
    });
  }
  return pool;
}

/**
 * Run migrations on the test database
 */
async function setupTestDb() {
  const p = getTestPool();
  const client = await p.connect();
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
    const migrationsDir = path.join(__dirname, '../../src/db/migrations');
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
async function cleanTestDb() {
  const p = getTestPool();
  await p.query(`
    TRUNCATE TABLE
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
async function closeTestDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getTestPool,
  setupTestDb,
  cleanTestDb,
  closeTestDb,
};
