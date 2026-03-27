/**
 * Test auth helper
 * Creates test users and returns their tokens.
 */
const request = require('supertest');
const { app } = require('../../src/app');

/**
 * Register a test user and return { token, user }
 */
async function createTestUser(overrides = {}) {
  const data = {
    employee_id: overrides.employee_id || 'EMP' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    display_name: overrides.display_name || 'テストユーザー',
    password: overrides.password || 'password123',
  };

  const res = await request(app)
    .post('/api/auth/register')
    .send(data);

  return { token: res.body.token, user: res.body.user };
}

module.exports = { createTestUser };
