const { getTestPool, setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');

describe('Database', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('should connect to the test database', async () => {
    const pool = getTestPool();
    const result = await pool.query('SELECT 1 + 1 AS sum');
    expect(result.rows[0].sum).toBe(2);
  });

  it('should have users table', async () => {
    const pool = getTestPool();
    const result = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    const columns = result.rows.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('login_id');
    expect(columns).toContain('display_name');
    expect(columns).toContain('password_hash');
  });

  it('should have rooms table', async () => {
    const pool = getTestPool();
    const result = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rooms'
      ORDER BY ordinal_position
    `);
    const columns = result.rows.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('type');
    expect(columns).toContain('name');
  });

  it('should have messages table', async () => {
    const pool = getTestPool();
    const result = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'messages'
      ORDER BY ordinal_position
    `);
    const columns = result.rows.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('room_id');
    expect(columns).toContain('sender_id');
    expect(columns).toContain('content');
    expect(columns).toContain('reply_to');
  });

  it('should have all Phase 1 tables', async () => {
    const pool = getTestPool();
    const result = await pool.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const tables = result.rows.map(r => r.tablename);
    expect(tables).toContain('users');
    expect(tables).toContain('rooms');
    expect(tables).toContain('room_members');
    expect(tables).toContain('messages');
    expect(tables).toContain('message_media');
    expect(tables).toContain('room_read_cursors');
    expect(tables).toContain('push_subscriptions');
  });

  it('should have RLS enabled on messages', async () => {
    const pool = getTestPool();
    const result = await pool.query(`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'messages'
    `);
    expect(result.rows[0].relrowsecurity).toBe(true);
  });
});
