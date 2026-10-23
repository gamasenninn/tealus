/**
 * #355 実際に返る Cache-Control を固定する。
 *
 * 純関数側 (unit/staticCache) が正しくても express への配線が抜けていれば意味がないので、
 * 配線そのものをここで押さえる。
 *
 * ★ 2026-10-23 (改善ループ 11 回目): 以前は「ビルド済みなら検証する」形で、CI (client を build しない) では
 *   3 本が skip・1 本が何も確かめずに緑だった = 配線が外れても CI は気づけなかった。
 *   client/dist が無ければ、テストの間だけ小さな見本 (index.html / sw.js / assets/x.<hash>.js) を置いて必ず叩く。
 *   ★★ 既にある dist (本番のビルド) には何も書かない・消さない。置いたものだけ後で消す
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/app.mts';

const clientDistPath = path.join(import.meta.dirname, '../../../client/dist');
// ★ index.html が無いときだけ見本を置く (dist の器だけある = ビルドの途中、でも置く)。消すのは自分が置いたファイルだけ
const created: string[] = [];
if (!fs.existsSync(path.join(clientDistPath, 'index.html'))) {
  const put = (rel: string, body: string) => {
    const p = path.join(clientDistPath, rel);
    if (fs.existsSync(p)) return;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    created.push(p);
  };
  put('index.html', '<!doctype html><title>t</title>');
  put('sw.js', '// sw');
  put(path.join('assets', 'index-abc12345.js'), '// asset');
}
afterAll(() => { for (const p of created) fs.rmSync(p, { force: true }); });

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
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
    });

    it('ルート / は no-store', async () => {
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
