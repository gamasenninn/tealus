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
  for (const name of ['a.html', 'b.htm', 'c.svg', 'd.xml', 'e.xhtml', 'f.pdf', 'g.png', 'h.md', 'noext']) {
    fs.writeFileSync(path.join(root, 'files', name), 'x');
  }
  app = express();
  app.use('/media', mediaStatic(root));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
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
