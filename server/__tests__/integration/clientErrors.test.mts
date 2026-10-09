/**
 * #525 POST /api/client-errors — 画面で起きたエラーを本体のログに 1 行残す。
 *
 * ★ 以前は利用者の端末で起きたエラーがどこにも残らなかった。
 * ★ 投稿の本文は送らない約束 (画面側)。ここでは長さを切り、決まった欄だけをログに書く。
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../../src/app.mts';
import { logger } from '../../src/utils/logger.mts';
import { generateToken } from '../../src/middleware/auth.mts';
import { CLIENT_ERROR_LIMIT, resetClientErrorLimits } from '../../src/routes/clientErrors.mts';

const valid = {
  kind: 'render',
  message: 'Cannot read properties of undefined (reading "name")',
  stack: 'TypeError: Cannot read properties of undefined\n    at ChatRoom (index-abc.js:1:2)',
  path: '/rooms/8bbedbe0-2429-4cd4-a269-823df4d92104',
  build: 'index-DkEVMCaT.js',
};

describe('POST /api/client-errors', () => {
  let warn: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    resetClientErrorLimits();
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });
  afterEach(() => warn.mockRestore());

  const logged = (): string[] => (warn.mock.calls as unknown[][]).map((c) => String(c[0])).filter((s: string) => s.startsWith('[client-error]'));

  it('ログインしていなくても受けて、ログに 1 行残す (ログイン画面で落ちることもある)', async () => {
    const res = await request(app).post('/api/client-errors').send(valid);
    expect(res.status).toBe(204);
    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/kind=render/);
    expect(lines[0]).toMatch(/Cannot read properties of undefined/);
    expect(lines[0]).toMatch(/at ChatRoom/);
    expect(lines[0]).toMatch(/build=index-DkEVMCaT\.js/);
    expect(lines[0]).toMatch(/user=-/);
  });

  it('ログインしていれば、誰の画面かを添える', async () => {
    const token = generateToken({ id: '11111111-1111-1111-1111-111111111111', login_id: 'x' });
    await request(app).post('/api/client-errors').set('Authorization', `Bearer ${token}`).send(valid);
    expect(logged()[0]).toMatch(/user=11111111/);
  });

  it('★ 壊れたトークンでも受ける (認証の失敗で記録を落とさない)', async () => {
    const res = await request(app).post('/api/client-errors').set('Authorization', 'Bearer broken').send(valid);
    expect(res.status).toBe(204);
    expect(logged()[0]).toMatch(/user=-/);
  });

  it('★ 長い値は切る・改行は 1 行にまとめる (ログを汚さない)', async () => {
    await request(app).post('/api/client-errors').send({ ...valid, message: 'x'.repeat(5000), stack: 'a\nb\nc\nd\ne\nf\ng' });
    const line = logged()[0];
    expect(line.length).toBeLessThan(1500);
    expect(line).not.toMatch(/\n/);
  });

  it('種類が決まったもの以外なら 400 で、ログに書かない', async () => {
    const res = await request(app).post('/api/client-errors').send({ ...valid, kind: 'whatever' });
    expect(res.status).toBe(400);
    expect(logged()).toHaveLength(0);
  });

  it('★ 送り手ごとに回数の上限 (壊れた画面が送り続けてもログが溢れない)', async () => {
    for (let i = 0; i < CLIENT_ERROR_LIMIT; i++) {
      expect((await request(app).post('/api/client-errors').send(valid)).status).toBe(204);
    }
    const over = await request(app).post('/api/client-errors').send(valid);
    expect(over.status).toBe(429);
    expect(logged()).toHaveLength(CLIENT_ERROR_LIMIT);
  });
});
