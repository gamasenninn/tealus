/**
 * Migration 022_user_role_guest.sql の動作検証 (#282 Phase A)
 *
 * users.role の CHECK constraint を ('admin', 'user') → ('admin', 'user', 'guest') に
 * 拡張する migration の TDD 検証。
 *
 * 検証観点:
 * - 新規 guest role が insert 可能
 * - 既存 admin / user role insert は変わらず可能 (後方互換)
 * - 不正 role ('superadmin' 等) は依然 CHECK constraint で reject
 * - default role は 'user' のまま (breaking change なし)
 * - 既存 user の role が変更されない (migration 安全性)
 */
const bcrypt = require('bcrypt');
const { getTestPool, setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');

let pool;

beforeAll(async () => {
  await setupTestDb();
  pool = getTestPool();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await cleanTestDb();
});

async function insertUser(loginId, displayName, role) {
  const passwordHash = await bcrypt.hash('test_password', 4);
  const params = role !== undefined
    ? [loginId, displayName, passwordHash, role]
    : [loginId, displayName, passwordHash];
  const sql = role !== undefined
    ? 'INSERT INTO users (login_id, display_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, role'
    : 'INSERT INTO users (login_id, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, role';
  return await pool.query(sql, params);
}

describe('Migration #282 — users.role CHECK constraint で guest を受け入れる', () => {
  test('role=guest の user が insert できる', async () => {
    const result = await insertUser('guest_alice', 'Guest Alice', 'guest');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].role).toBe('guest');
  });

  test('role=admin / role=user の既存 role は依然 insert できる (後方互換)', async () => {
    const adminResult = await insertUser('admin_bob', 'Admin Bob', 'admin');
    expect(adminResult.rows[0].role).toBe('admin');

    const userResult = await insertUser('user_carol', 'User Carol', 'user');
    expect(userResult.rows[0].role).toBe('user');
  });

  test('role を省略すると default=user (breaking change なし)', async () => {
    const result = await insertUser('default_dave', 'Default Dave');
    expect(result.rows[0].role).toBe('user');
  });

  test('不正 role (superadmin / owner / 空文字) は CHECK constraint で reject', async () => {
    // note: PG の CHECK constraint は NULL を unknown 扱いで pass させる仕様、role NOT NULL は別 scope (本 Issue 対象外)
    await expect(insertUser('bad1', 'Bad 1', 'superadmin')).rejects.toThrow(/violates check constraint|invalid input/);
    await expect(insertUser('bad2', 'Bad 2', 'owner')).rejects.toThrow(/violates check constraint|invalid input/);
    await expect(insertUser('bad3', 'Bad 3', '')).rejects.toThrow(/violates check constraint/);
  });

  test('既存 admin user の role を guest に UPDATE できる (= admin が demote 可能、role migration の柔軟性)', async () => {
    const inserted = await insertUser('mutable_eve', 'Eve', 'admin');
    const userId = inserted.rows[0].id;

    const updated = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING role', ['guest', userId]);
    expect(updated.rows[0].role).toBe('guest');
  });

  test('既存 user を不正 role に UPDATE しようとすると reject', async () => {
    const inserted = await insertUser('protected_frank', 'Frank', 'user');
    const userId = inserted.rows[0].id;

    await expect(
      pool.query('UPDATE users SET role = $1 WHERE id = $2', ['superguest', userId])
    ).rejects.toThrow(/violates check constraint/);
  });
});
