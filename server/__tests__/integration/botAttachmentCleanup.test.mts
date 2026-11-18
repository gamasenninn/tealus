/**
 * bot の画像・ファイルの投稿 (push-image / push-file) で、断ったときの後始末 (改善ループ 63、#649 A-1)
 *
 * ★ メンバーでない部屋に投稿しようとすると、DB の接続を 2 回返して例外になっていた
 *   (403 は返るので画面は普通。2026-11-18 のリファクタリングの棚卸しで、コードを読んで見つけた。本番ではまだ通っていない道)
 * ★ 受け取ったファイルを消すのは「説明文が長い・大きすぎ・画像として読めない」の 3 つだけで、
 *   ほかの断り方 (部屋の指定なし・メンバーでない など) ではディスクに残っていた
 */
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { app } from '../../src/app.mts';
import { MEDIA_ROOT } from '../../src/middleware/upload.mts';
import { pool } from '../../src/db/pool.mts';
import { logger } from '../../src/utils/logger.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

function filesIn(sub: string): Set<string> {
  try { return new Set(fs.readdirSync(path.join(MEDIA_ROOT, sub))); } catch { return new Set(); }
}

describe('bot の画像・ファイルの投稿: 断ったときの後始末', () => {
  let owner: TestUser, outsider: TestUser, roomId: string, png: Buffer;

  beforeAll(async () => {
    await setupTestDb();
    png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
  });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    owner = await createTestUser({ login_id: 'EMP001', display_name: '持ち主' });
    outsider = await createTestUser({ login_id: 'EMP002', display_name: '部屋の外' });
    const r = await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`).send({ name: '部屋', member_ids: [] });
    roomId = r.body.room.id;
  });

  const cases = [
    { route: '/api/bot/push-image', field: 'image', sub: 'images' },
    { route: '/api/bot/push-file', field: 'file', sub: 'images' },   // image/png なので images に置かれる
  ];

  for (const c of cases) {
    it(`★ ${c.route}: メンバーでない部屋は 403、接続を 2 回返さず、受け取ったファイルも残さない`, async () => {
      const errorSpy = jest.spyOn(logger, 'error');
      const before = filesIn(c.sub);
      const res = await request(app).post(c.route).set('Authorization', `Bearer ${outsider.token}`)
        .field('room_id', roomId).attach(c.field, png, { filename: 'a.png', contentType: 'image/png' });
      expect(res.status).toBe(403);
      // 応答のあとの後始末が終わるのを少し待つ
      await new Promise((r) => setTimeout(r, 50));
      expect([...filesIn(c.sub)].filter((f) => !before.has(f))).toEqual([]);
      const released = errorSpy.mock.calls.map((a) => (a as unknown[]).map(String).join(' ')).filter((l) => /Release called/i.test(l));
      expect(released).toEqual([]);
      errorSpy.mockRestore();
      // 接続の数え方が壊れていない (使っている数が 0 に戻る)
      expect(pool.totalCount - pool.idleCount).toBe(0);
    });

    it(`★ ${c.route}: room_id が無くて 400 のときも、受け取ったファイルを残さない`, async () => {
      const before = filesIn(c.sub);
      const res = await request(app).post(c.route).set('Authorization', `Bearer ${owner.token}`)
        .attach(c.field, png, { filename: 'a.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
      await new Promise((r) => setTimeout(r, 50));
      expect([...filesIn(c.sub)].filter((f) => !before.has(f))).toEqual([]);
    });

    it(`${c.route}: メンバーなら 201 で、ファイルは残る (前提の確認)`, async () => {
      const before = filesIn(c.sub);
      const res = await request(app).post(c.route).set('Authorization', `Bearer ${owner.token}`)
        .field('room_id', roomId).attach(c.field, png, { filename: 'a.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
      await new Promise((r) => setTimeout(r, 50));
      const added = [...filesIn(c.sub)].filter((f) => !before.has(f));
      expect(added.length).toBeGreaterThanOrEqual(1);
      for (const f of added) fs.rmSync(path.join(MEDIA_ROOT, c.sub, f), { force: true });
    });
  }
});
