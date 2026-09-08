const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '.env.test') });

// ★★ テストが本番の設定ファイルを書き換えないようにする (2026-09-08)
//
// 実害 2 回 (2026-09-07 18:47 / 2026-09-08 13:20): `npm test` を回すと、本番の
// `server/config/dictionary.local.ttl` が 58KB / 292 term → 338 バイト / 1 term に縮んだ。
//   `request(app)` を使う統合テストがアプリ本体を読み込む
//   → dictionary の統合テストが TRUNCATE してから API を叩く
//   → refreshVocabFromTable() が走り、空に近いテスト DB の内容で ttl を書き出す
//
// ★ DB は .env.test (port 5433 / tealus_test) で守られていた。守られていなかったのは
//   **ファイルの書き出し先**で、LOCAL_TTL_PATH 未設定だと本番の config/ を指す。
// ★★ ここに置くのは .env.test が gitignore されていて **後続者に配られない**ため。
//   既に設定されていれば尊重する (各自の上書きを壊さない)。
if (!process.env.LOCAL_TTL_PATH) {
  process.env.LOCAL_TTL_PATH = path.join(os.tmpdir(), `tealus-test-dictionary.local.${process.pid}.ttl`);
}
