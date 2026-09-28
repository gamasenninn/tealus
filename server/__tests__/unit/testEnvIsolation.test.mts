/**
 * テストは本番の server/.env を読まない (#468, 2026-09-28)
 *
 * ★ jest.setup.js は .env.test を読むが、アプリ本体が起動時に src/env.mts で server/.env (本番) も読んでいた。
 *   .env.test に無い項目 (24 個) は本番の値になり、npm test のたびにテストのダミーのファイルが
 *   本番のメディアのフォルダへ書かれていた (2026-09-28 だけで約 580 件)。
 * ★ ログ (jest.setupAfterEnv.js) と辞書のファイル (jest.setup.js の LOCAL_TTL_PATH) と同じく、入口で止める。
 * ★ CI には本番の .env が無いので、ここは手元でだけ意味を持つ (CI では最初から通る)。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import '../../src/env.mts';
import { MEDIA_ROOT } from '../../src/middleware/upload.mts';

const prodEnvPath = path.join(import.meta.dirname, '../../.env');
const testEnvPath = path.join(import.meta.dirname, '../../.env.test');
const prod = fs.existsSync(prodEnvPath) ? dotenv.parse(fs.readFileSync(prodEnvPath)) : {};
const test = fs.existsSync(testEnvPath) ? dotenv.parse(fs.readFileSync(testEnvPath)) : {};

describe('テストは本番の .env を読まない', () => {
  it('★ メディアの置き場所はテスト用の一時フォルダ', () => {
    expect(path.resolve(MEDIA_ROOT).startsWith(path.resolve(os.tmpdir()))).toBe(true);
    if (prod.MEDIA_ROOT) expect(path.resolve(MEDIA_ROOT)).not.toBe(path.resolve(prod.MEDIA_ROOT));
  });

  it('★ 本番の .env にだけある項目は、テストから見えない', () => {
    const onlyInProd = Object.keys(prod).filter((k) => !(k in test) && k !== 'MEDIA_ROOT');
    const leaked = onlyInProd.filter((k) => process.env[k] !== undefined && process.env[k] === prod[k]);
    expect(leaked).toEqual([]);
  });
});
