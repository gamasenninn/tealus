import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

// Create test fixtures directory and files
const fixturesDir = path.join(import.meta.dirname, '../fixtures');

async function ensureFixtures() {
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  // Create a valid PNG using sharp
  const pngPath = path.join(fixturesDir, 'test.png');
  if (!fs.existsSync(pngPath)) {
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).png().toFile(pngPath);
  }

  // Create a small text file
  const txtPath = path.join(fixturesDir, 'test.txt');
  if (!fs.existsSync(txtPath)) {
    fs.writeFileSync(txtPath, 'テストファイル');
  }

  return { pngPath, txtPath };
}

describe('Media API', () => {
  let user1: Awaited<ReturnType<typeof createTestUser>>;
  let user2: Awaited<ReturnType<typeof createTestUser>>;
  let user3: Awaited<ReturnType<typeof createTestUser>>;
  let roomId: string;
  let fixtures: Awaited<ReturnType<typeof ensureFixtures>>;

  beforeAll(async () => {
    await setupTestDb();
    fixtures = await ensureFixtures();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
    user3 = await createTestUser({ login_id: 'EMP003', display_name: '佐藤次郎' });

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;
  });

  // ============================================
  // POST /api/rooms/:id/media
  // ============================================
  describe('POST /api/rooms/:id/media', () => {
    it('should upload an image and create a message', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('files', fixtures.pngPath);

      expect(res.status).toBe(201);
      expect(res.body.message).toBeDefined();
      expect(res.body.message.type).toBe('image');
      expect(res.body.media).toBeDefined();
      expect(res.body.media[0].mime_type).toBe('image/png');
      expect(res.body.media[0].file_path).toBeDefined();
      expect(res.body.media[0].thumbnail_path).toBeDefined();
    });

    it('should upload a generic file', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('files', fixtures.txtPath);

      expect(res.status).toBe(201);
      expect(res.body.message.type).toBe('file');
      expect(res.body.media[0].mime_type).toBe('text/plain');
      expect(res.body.media[0].thumbnail_path).toBeNull();
    });

    // ★ #497 種類ごとの上限をサーバーでも効かせる。それまでは 1 ファイル 1GB しか見ていなかった
    describe('種類ごとの上限 (#497)', () => {
      const MB = 1024 * 1024;
      const filesIn = (sub: string) => {
        const dir = path.join(process.env.MEDIA_ROOT!, sub);
        return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      };

      it('★★ 10MB を超える画像は 413。どのファイルが何 MB までかを返し、保存したファイルは残さない', async () => {
        const before = filesIn('images').length;
        const res = await request(app)
          .post(`/api/rooms/${roomId}/media`)
          .set('Authorization', `Bearer ${user1.token}`)
          .attach('files', Buffer.alloc(10 * MB + 1), { filename: '大きい.png', contentType: 'image/png' });

        expect(res.status).toBe(413);
        expect(res.body.error).toBe('大きい.png のサイズが上限（10MB）を超えています');
        expect(filesIn('images').length).toBe(before);
        const hist = await request(app).get(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${user1.token}`);
        expect(hist.body.messages.filter((m: { type: string }) => m.type === 'image')).toHaveLength(0);
      });

      it('★ 複数のうち 1 つでも超えたら全部を断る (一緒に送った小さいファイルも残さない)', async () => {
        const beforeImages = filesIn('images').length;
        const beforeFiles = filesIn('files').length;
        const res = await request(app)
          .post(`/api/rooms/${roomId}/media`)
          .set('Authorization', `Bearer ${user1.token}`)
          .attach('files', fixtures.pngPath)
          .attach('files', Buffer.alloc(100 * MB + 1), { filename: '大きい.pdf', contentType: 'application/pdf' });

        expect(res.status).toBe(413);
        expect(res.body.error).toBe('大きい.pdf のサイズが上限（100MB）を超えています');
        expect(filesIn('images').length).toBe(beforeImages);
        expect(filesIn('files').length).toBe(beforeFiles);
      });

      it('上限ちょうどの画像は通る', async () => {
        const res = await request(app)
          .post(`/api/rooms/${roomId}/media`)
          .set('Authorization', `Bearer ${user1.token}`)
          .attach('files', Buffer.alloc(10 * MB), { filename: 'ちょうど.png', contentType: 'image/png' });
        expect(res.status).not.toBe(413);
      });
    });

    it('should reject upload without file', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(400);
    });

    it('should reject non-member from uploading', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user3.token}`)
        .attach('files', fixtures.pngPath);

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`);

      expect(res.status).toBe(401);
    });

    it('should include media info in message history', async () => {
      await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('files', fixtures.pngPath);

      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0].type).toBe('image');
      expect(res.body.messages[0].media).toBeDefined();
      expect(res.body.messages[0].media.length).toBeGreaterThan(0);
    });
  });
});
