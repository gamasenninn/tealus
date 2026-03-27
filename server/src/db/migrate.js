/**
 * Simple migration runner
 * Reads SQL files from migrations/ and executes them in order.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrate(config) {
  const pool = new Pool(config || {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'lifeline',
    user: process.env.DB_USER || 'lifeline',
    password: process.env.DB_PASSWORD || 'lifeline_dev',
  });

  const migrationsDir = path.join(__dirname, 'migrations');
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
if (require.main === module) {
  require('dotenv').config();
  migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = migrate;
