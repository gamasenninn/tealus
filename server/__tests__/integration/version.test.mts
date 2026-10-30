/**
 * #356 GET /api/version — いま配っているクライアントのビルド ID を返す。
 *
 * クライアントは自分に焼き込まれた __BUILD_ID__ とこれを突き合わせ、食い違えば
 * 「更新あり」と判断する。`/api/*` は SW の precache 対象外かつ navigateFallbackDenylist にも
 * 入っているため、SW が古い画面を出していてもこの経路だけはネットワークに届く。それが要。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/app.mts';

// ★ 本番の client/dist/version.json には触らない (2026-10-30 改善ループ 27 回目)。以前はここで書き換えて戻しており、
//   本番の端末に「新しいバージョンがあります」が出うる・途中で止めると戻らない形だった
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tealus-version-'));
const versionPath = path.join(tmpDir, 'version.json');
const realVersionPath = path.join(import.meta.dirname, '../../../client/dist/version.json');

describe('GET /api/version', () => {
  const saved = process.env.CLIENT_VERSION_FILE;
  beforeAll(() => { process.env.CLIENT_VERSION_FILE = versionPath; });
  afterAll(() => {
    if (saved === undefined) delete process.env.CLIENT_VERSION_FILE; else process.env.CLIENT_VERSION_FILE = saved;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  beforeEach(() => { fs.rmSync(versionPath, { force: true }); });

  it('認証なしで叩ける (ログイン画面でも陳腐化を検知できる必要がある)', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
  });

  it('キャッシュさせない (古い ID が返ると検知そのものが死ぬ)', async () => {
    const res = await request(app).get('/api/version');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('version.json の内容をそのまま返す', async () => {
    fs.writeFileSync(versionPath, JSON.stringify({ build_id: '2026-10-30 10:00 abc1234' }));
    const res = await request(app).get('/api/version');
    expect(res.body.build_id).toBe('2026-10-30 10:00 abc1234');
  });

  it('未ビルドでも 500 にせず build_id: null を返す (不明として扱わせる)', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body.build_id).toBeNull();
  });

  it('リクエストのたびに読み直す (サーバ稼働中の再ビルドを取り違えない)', async () => {
    fs.writeFileSync(versionPath, JSON.stringify({ build_id: 'first' }));
    expect((await request(app).get('/api/version')).body.build_id).toBe('first');
    fs.writeFileSync(versionPath, JSON.stringify({ build_id: 'test-rebuild-marker' }));
    expect((await request(app).get('/api/version')).body.build_id).toBe('test-rebuild-marker');
  });

  it('★ 本番の client/dist/version.json に触らない', async () => {
    const before = fs.existsSync(realVersionPath) ? fs.statSync(realVersionPath).mtimeMs : null;
    await request(app).get('/api/version');
    const after = fs.existsSync(realVersionPath) ? fs.statSync(realVersionPath).mtimeMs : null;
    expect(after).toBe(before);
  });
});
