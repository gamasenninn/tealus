/**
 * #356 GET /api/version — いま配っているクライアントのビルド ID を返す。
 *
 * クライアントは自分に焼き込まれた __BUILD_ID__ とこれを突き合わせ、食い違えば
 * 「更新あり」と判断する。`/api/*` は SW の precache 対象外かつ navigateFallbackDenylist にも
 * 入っているため、SW が古い画面を出していてもこの経路だけはネットワークに届く。それが要。
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/app.mts';

const versionPath = path.join(import.meta.dirname, '../../../client/dist/version.json');

describe('GET /api/version', () => {
  it('認証なしで叩ける (ログイン画面でも陳腐化を検知できる必要がある)', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
  });

  it('build_id フィールドを必ず返す', async () => {
    const res = await request(app).get('/api/version');
    expect(res.body).toHaveProperty('build_id');
  });

  it('キャッシュさせない (古い ID が返ると検知そのものが死ぬ)', async () => {
    const res = await request(app).get('/api/version');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('dist/version.json の内容をそのまま返す', async () => {
    if (!fs.existsSync(versionPath)) return; // 未ビルド環境では対象外
    const expected = JSON.parse(fs.readFileSync(versionPath, 'utf8')).build_id;
    const res = await request(app).get('/api/version');
    expect(res.body.build_id).toBe(expected);
  });

  it('未ビルドでも 500 にせず build_id: null を返す (不明として扱わせる)', async () => {
    const res = await request(app).get('/api/version');
    if (fs.existsSync(versionPath)) return; // ビルド済みならこのケースは検証できない
    expect(res.status).toBe(200);
    expect(res.body.build_id).toBeNull();
  });

  it('リクエストのたびに読み直す (サーバ稼働中の再ビルドを取り違えない)', async () => {
    if (!fs.existsSync(versionPath)) return;
    const original = fs.readFileSync(versionPath, 'utf8');
    try {
      fs.writeFileSync(versionPath, JSON.stringify({ build_id: 'test-rebuild-marker' }));
      const res = await request(app).get('/api/version');
      expect(res.body.build_id).toBe('test-rebuild-marker');
    } finally {
      fs.writeFileSync(versionPath, original);
    }
  });
});
