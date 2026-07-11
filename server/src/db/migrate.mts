/**
 * Simple migration runner
 * Reads SQL files from migrations/ and executes them in order.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

export async function migrate(config?: pg.PoolConfig): Promise<void> {
  const pool = new pg.Pool(config || {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'tealus',
    user: process.env.DB_USER || 'tealus',
    password: process.env.DB_PASSWORD || 'tealus_dev',
  });

  const migrationsDir = path.join(import.meta.dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Running migration: ${file}`);
      await client.query(sql);
      console.log(`  Done: ${file}`);
    }
    console.log('All migrations completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

// Run directly
if (import.meta.main) {
  dotenv.config();
  migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
