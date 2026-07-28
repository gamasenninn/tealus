/**
 * #355 実際に返る Cache-Control を固定する。
 *
 * 純関数側 (unit/staticCache) が正しくても express への配線が抜けていれば意味がないので、
 * 配線そのものをここで押さえる。client/dist は未ビルドのこともあるため、
 * 「ビルド済みなら検証する」形にして未ビルド環境で赤くしない。
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/app.mts';

const clientDistPath = path.join(import.meta.dirname, '../../../client/dist');
const hasClientBuild = fs.existsSync(path.join(clientDistPath, 'index.html'));

/** dist/assets から実在するハッシュ付きファイルを 1 つ拾う */
function findHashedAsset(): string | null {
  const dir = path.join(clientDistPath, 'assets');
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find(f => f.endsWith('.js') || f.endsWith('.css'));
  return hit ? `/assets/${hit}` : null;
}

describe('静的配信の Cache-Control', () => {
  describe('更新の入口は保存させない', () => {
    it('SPA fallback (未知のパス) は no-store', async () => {
      const res = await request(app).get('/some/spa/route');
      // 未ビルドなら 503 (案内 HTML) が返るのでその場合は対象外
      if (res.status !== 200) return;
      expect(res.headers['cache-control']).toMatch(/no-store/);
    });

    (hasClientBuild ? it : it.skip)('ルート / は no-store', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
    });

    (hasClientBuild && fs.existsSync(path.join(clientDistPath, 'sw.js')) ? it : it.skip)(
      'service worker 本体は no-store (ここが古いと何も更新されない)',
      async () => {
        const res = await request(app).get('/sw.js');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toMatch(/no-store/);
      }
    );
  });

  describe('内容ハッシュ付き資産は長期キャッシュ', () => {
    const asset = hasClientBuild ? findHashedAsset() : null;

    (asset ? it : it.skip)('/assets/* は immutable', async () => {
      const res = await request(app).get(asset!);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/immutable/);
      expect(res.headers['cache-control']).toMatch(/max-age=31536000/);
    });
  });

  describe('API は静的配信の方針に巻き込まれない', () => {
    it('/api/* に immutable が付かない', async () => {
      const res = await request(app).get('/api/config');
      expect(res.headers['cache-control'] || '').not.toMatch(/immutable/);
    });
  });
});
