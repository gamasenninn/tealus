/**
 * Test auth helper
 * Creates test users and returns their tokens.
 */
const request = require('supertest');
const { app } = require('../../src/app');
const { getTestPool } = require('./db');

/**
 * Register a test user and return { token, user }.
 *
 * #211: 本番では最初の非 Bot ユーザーが auto-promote で admin になる仕様。
 * テストでは controlled な initial role が欲しいので、register 後に
 * DEFAULT 'user' に reset する (個別テストで admin が必要なら DB UPDATE する)。
 * authenticate middleware は DB から role を毎回読むので token 再発行は不要。
 */
async function createTestUser(overrides = {}) {
  const data = {
    login_id: overrides.login_id || 'EMP' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    display_name: overrides.display_name || 'テストユーザー',
    password: overrides.password || 'password123',
  };

  const res = await request(app)
    .post('/api/auth/register')
    .send(data);

  // Reset role to 'user' (auto-promote で 'admin' になっていても上書き)
  const pool = getTestPool();
  await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [res.body.user.id]);
  res.body.user.role = 'user';

  return { token: res.body.token, user: res.body.user };
}

module.exports = { createTestUser };
