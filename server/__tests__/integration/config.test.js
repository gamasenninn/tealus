const request = require('supertest');
const { app } = require('../../src/app');

describe('GET /api/config', () => {
  it('returns config shape with safe fallback when agent-server is unreachable', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tts_provider');
    expect(res.body).toHaveProperty('vapid_public_key');
    expect(['browser', 'aivis-cloud', 'none']).toContain(res.body.tts_provider);
  });

  it('returns vapid_public_key from server env', async () => {
    const orig = process.env.VAPID_PUBLIC_KEY;
    process.env.VAPID_PUBLIC_KEY = 'test-key-from-env';
    try {
      const res = await request(app).get('/api/config');
      expect(res.body.vapid_public_key).toBe('test-key-from-env');
    } finally {
      if (orig === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = orig;
    }
  });

  it('does not require authentication', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
  });
});
