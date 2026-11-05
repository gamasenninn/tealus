import request from 'supertest';
import { jest } from '@jest/globals';
import { app } from '../../src/app.mts';
import { resetPublicConfigCache } from '../../src/routes/config.mts';

describe('GET /api/config', () => {
  it('returns config shape with safe fallback when agent-server is unreachable', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tts_provider');
    expect(res.body).toHaveProperty('vapid_public_key');
    expect(['browser', 'aivis-cloud', 'openai', 'none']).toContain(res.body.tts_provider);
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

  // ★ 改善ループ 39: 11-04 に 1 台の端末が 3 時間で 8.7 万回叩き、そのたびに agent-server へ取りに行っていた
  it('reuses the agent-server answer for a while instead of fetching on every request', async () => {
    resetPublicConfigCache();
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ tts_provider: 'openai' }), { status: 200 }),
    );
    try {
      const a = await request(app).get('/api/config');
      const b = await request(app).get('/api/config');
      expect(a.body.tts_provider).toBe('openai');
      expect(b.body.tts_provider).toBe('openai');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      resetPublicConfigCache();
    }
  });

  it('does not keep the fallback when agent-server was unreachable', async () => {
    resetPublicConfigCache();
    const spy = jest.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(new Response(JSON.stringify({ tts_provider: 'openai' }), { status: 200 }));
    try {
      const a = await request(app).get('/api/config');
      const b = await request(app).get('/api/config');
      expect(a.body.tts_provider).toBe('browser');
      expect(b.body.tts_provider).toBe('openai');
    } finally {
      spy.mockRestore();
      resetPublicConfigCache();
    }
  });

  it('returns realtime_voice_available field (boolean)', async () => {
    const res = await request(app).get('/api/config');
    expect(res.body).toHaveProperty('realtime_voice_available');
    expect(typeof res.body.realtime_voice_available).toBe('boolean');
  });
});
