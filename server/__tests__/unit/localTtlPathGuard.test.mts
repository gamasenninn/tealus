/**
 * ★★ テストが本番の設定ファイルを書き換えないことを固定する (2026-09-08)
 *
 * 実害 (2026-09-07 18:47 / 2026-09-08 13:20 の 2 回): `npm test` を回すと
 * **本番の `server/config/dictionary.local.ttl` が 58KB / 292 term から 338 バイト / 1 term に縮んだ。**
 *
 * 経路:
 *   `request(app)` を使う統合テストがアプリ本体を読み込む
 *   → dictionary の統合テストが `TRUNCATE dictionary_terms` してから API を叩く
 *   → `refreshVocabFromTable()` が走り、**空に近いテスト DB の内容で ttl を書き出す**
 *   ★ DB 自体は `.env.test` (port 5433 / tealus_test) で守られていた。**守られていなかったのは
 *     ファイルの書き出し先**で、`LOCAL_TTL_PATH` 未設定だと本番の config/ を指す。
 *
 * ★ ここで固定するのは「テスト実行中に本番の path を指していないこと」の 1 点。
 *   ★★ `DEFAULT_LOCAL_TTL_PATH` は **module 読み込み時に確定する**ので、
 *   `.env.test` (jest の `setupFiles` で読まれる = module 読込より前) で渡すしかない。
 *   テストの中で `process.env` を書き換えても遅い —— それがこのテストの存在理由。
 */
import path from 'node:path';

const { DEFAULT_LOCAL_TTL_PATH } = require('../../src/services/dictionaryTtl.mts') as {
  DEFAULT_LOCAL_TTL_PATH: string;
};

describe('local.ttl の書き出し先 — テストは本番を指さない', () => {
  test('★★ LOCAL_TTL_PATH が設定されている (未設定だと本番 config/ を指す)', () => {
    expect(process.env.LOCAL_TTL_PATH).toBeTruthy();
  });

  test('★★★ 書き出し先が server/config/ の下でない', () => {
    const resolved = path.resolve(DEFAULT_LOCAL_TTL_PATH);
    const prodDir = path.resolve(__dirname, '../../config');
    expect(resolved.startsWith(prodDir + path.sep)).toBe(false);
  });

  test('★ 本番のファイル名そのものを指していない (念のため二重に)', () => {
    const prodFile = path.resolve(__dirname, '../../config/dictionary.local.ttl');
    expect(path.resolve(DEFAULT_LOCAL_TTL_PATH)).not.toBe(prodFile);
  });
});
