/**
 * /media の配り方 (2026-09-30)
 *
 * アップロードされたファイルは、本体の画面と切り離した扱い (CSP sandbox、allow-same-origin なし) で
 * 開かせる。スクリプトは動かす
 * (業務メモで HTML のドリルを開いて使っている)。
 * ★ PDF だけは外す —— 内蔵ビューアでの挙動を全ブラウザでは確かめていないので、変えない。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { mediaStatic, MEDIA_SANDBOX } from '../../src/utils/mediaStatic.mts';

let root: string;
let app: express.Express;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-static-'));
  fs.mkdirSync(path.join(root, 'files'));
  for (const name of ['a.html', 'b.htm', 'c.svg', 'd.xml', 'e.xhtml', 'f.pdf', 'g.png', 'h.md', 'noext', 'i.heic', 'j.heif', 'k.avif']) {
    fs.writeFileSync(path.join(root, 'files', name), 'x');
  }
  app = express();
  app.use('/media', mediaStatic(root));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('mediaStatic — 新しい画像の形式にも種類を付ける (改善ループ 18 回目)', () => {
  // ★ express の古い mime 表に無く、application/octet-stream で配っていた (nosniff 下ではブラウザが画像と扱わないことがある)
  it.each([['i.heic', 'image/heic'], ['j.heif', 'image/heif'], ['k.avif', 'image/avif']])('%s → %s', async (name, type) => {
    const res = await request(app).get(`/media/files/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(type);
  });
});

describe('mediaStatic — 文書として開けるものは切り離して開く', () => {
  it.each(['a.html', 'b.htm', 'c.svg', 'd.xml', 'e.xhtml'])('%s', async (name) => {
    const res = await request(app).get(`/media/files/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(MEDIA_SANDBOX);
  });

  it('切り離し方: スクリプトは動かすが、本体と同じオリジンとしては扱わない', () => {
    expect(MEDIA_SANDBOX).toMatch(/^sandbox\b/);
    expect(MEDIA_SANDBOX).toContain('allow-scripts');
    expect(MEDIA_SANDBOX).not.toContain('allow-same-origin');
  });

  it('画像・テキスト・拡張子なしも切り離す (PDF 以外は全部)', async () => {
    for (const name of ['g.png', 'h.md', 'noext']) {
      const res = await request(app).get(`/media/files/${name}`);
      expect(res.headers['content-security-policy']).toBe(MEDIA_SANDBOX);
    }
  });

  it('PDF は切り離さない (内蔵ビューアに任せる形式は変えない)', async () => {
    const res = await request(app).get('/media/files/f.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('大文字の拡張子でも同じ判定', async () => {
    fs.writeFileSync(path.join(root, 'files', 'U.PDF'), 'x');
    fs.writeFileSync(path.join(root, 'files', 'V.HTML'), 'x');
    expect((await request(app).get('/media/files/U.PDF')).headers['content-security-policy']).toBeUndefined();
    expect((await request(app).get('/media/files/V.HTML')).headers['content-security-policy']).toBe(MEDIA_SANDBOX);
  });
});

describe('mediaStatic — 中身から形式を推測させない', () => {
  it.each(['a.html', 'f.pdf', 'g.png', 'noext'])('%s に nosniff', async (name) => {
    const res = await request(app).get(`/media/files/${name}`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

/**
 * #601 削除した投稿の添付は 404 にする。判定 (DB) は外から渡し、配信の部品は DB を知らない
 */
describe('mediaStatic — 隠すファイル (#601)', () => {
  const seen: string[] = [];
  let hiddenApp: express.Express;
  beforeAll(() => {
    hiddenApp = express();
    hiddenApp.use('/media', mediaStatic(root, {
      isHidden: async (rel) => { seen.push(rel); return rel === 'files/g.png'; },
    }));
  });

  it('★★ 隠すと言われたファイルは 404', async () => {
    const res = await request(hiddenApp).get('/media/files/g.png');
    expect(res.status).toBe(404);
  });

  it('隠さないファイルは今までどおり開ける (切り離しのヘッダも付く)', async () => {
    const res = await request(hiddenApp).get('/media/files/a.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(MEDIA_SANDBOX);
  });

  it('★ 判定には /media からの相対パス (先頭の / なし・%エンコードを戻した形) を渡す', async () => {
    seen.length = 0;
    await request(hiddenApp).get('/media/files/h.md?x=1');
    expect(seen).toEqual(['files/h.md']);
  });

  it('★ 判定が失敗したら開かせない (隠すべきものを出さない)', async () => {
    const app2 = express();
    app2.use('/media', mediaStatic(root, { isHidden: async () => { throw new Error('db down'); } }));
    const res = await request(app2).get('/media/files/g.png');
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe('mediaStatic — 隠すファイルを書き方の違いですり抜けさせない (#601)', () => {
  let app3: express.Express;
  beforeAll(() => {
    app3 = express();
    app3.use('/media', mediaStatic(root, { isHidden: async (rel) => rel === 'files/g.png' }));
  });
  it.each([
    '/media/files/./g.png',
    '/media/files/../files/g.png',
    '/media/files/%67.png',
    '/media/FILES/G.PNG',      // Windows は大文字小文字を区別しない
    '/media/files/g.png.',     // Windows は末尾の . を無視する
  ])('%s は開けない', async (url) => {
    const res = await request(app3).get(url);
    expect(res.status).not.toBe(200);
  });
});
