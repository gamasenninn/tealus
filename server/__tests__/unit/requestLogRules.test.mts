/**
 * 「誰が」の記録 (改善ループ 9 回目の B・C) の仕分けの規則を、口ごとに 1 本ずつ押さえる (2026-10-23 改善ループ 11 回目)
 *
 * ★ 統合テスト (integration/requestLog) の「既読・プッシュの登録・通行証の発行は残さない」は既読しか叩いていなかった。
 *   NOT_A_CHANGE の正規表現を触ると、通行証の発行 (1 日数百回) が [change] に流れ出しても気づけない。
 *   429 (ログインの連打の止め) と、機械 (is_bot) の除外も確かめていなかった
 * ★ ここは仕分けの規則だけを見る (本物の口の配線は integration/requestLog が見る)
 */
import express from 'express';
import request from 'supertest';
import { requestLog } from '../../src/middleware/requestLog.mts';
import { logger } from '../../src/utils/logger.mts';

let info: jest.SpyInstance;
let warn: jest.SpyInstance;
const lines = (spy: jest.SpyInstance, prefix: string): string[] =>
  spy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith(prefix));
const settle = () => new Promise((r) => setImmediate(r));

function appAs(user: { id: string; is_bot?: boolean } | null, status = 200) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (user) (req as unknown as { user: unknown }).user = user; next(); });
  app.use(requestLog);
  app.all('*', (_req, res) => { res.status(status).json({ ok: status < 300 }); });
  return app;
}
const HUMAN = { id: 'aaaaaaaa-0000-0000-0000-000000000000' };

beforeEach(() => {
  info = jest.spyOn(logger, 'info').mockImplementation(() => logger as never);
  warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger as never);
});
afterEach(() => { info.mockRestore(); warn.mockRestore(); });

test.each([
  ['POST', '/api/rooms/r1/read'],
  ['POST', '/api/push/subscribe'],
  ['DELETE', '/api/push/subscribe'],
  ['POST', '/api/rooms/r1/app-pass'],
  ['POST', '/api/rooms/portal-links/p1/app-pass'],
  ['POST', '/api/auth/login'],
  ['POST', '/api/bot/heartbeat'],
])('日常の操作 %s %s は [change] に残さない', async (method, path) => {
  await (request(appAs(HUMAN)) as unknown as Record<string, (p: string) => request.Test>)[method.toLowerCase()](path).send({ x: 1 });
  await settle();
  expect(lines(info, '[change]')).toEqual([]);
});

test('設定を変える要求は [change] に残す (誰が・欄の名前だけ)', async () => {
  await request(appAs(HUMAN)).put('/api/rooms/r1').send({ message_edit_policy: 'sender' });
  await settle();
  expect(lines(info, '[change]')).toEqual(['[change] PUT /api/rooms/r1 200 by=aaaaaaaa fields=message_edit_policy']);
});

test('機械 (is_bot) の変更は [change] に残さない (投稿・心拍で 1 日に数千行になる)', async () => {
  await request(appAs({ id: 'bbbbbbbb-0000-0000-0000-000000000000', is_bot: true })).put('/api/rooms/r1').send({ name: 'x' });
  await settle();
  expect(lines(info, '[change]')).toEqual([]);
});

test.each([401, 403, 429])('断られた要求 (%i) は [http-denied] に残す', async (status) => {
  await request(appAs(null, status)).post('/api/auth/login').send({ login_id: 'x', password: 'secret' });
  await settle();
  const l = lines(warn, '[http-denied]');
  expect(l).toHaveLength(1);
  expect(l[0]).toContain(`${status} POST /api/auth/login`);
  expect(l[0]).not.toContain('secret');
});
