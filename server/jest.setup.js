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

// ★★ メディアの置き場所もテスト用の一時フォルダにする (#468、2026-09-28)
//   未設定だと src/middleware/upload.mts などの既定値が repo の media/ を指す。
//   ★ 以前は src/env.mts が本番の .env も読んでいて、本番のメディアのフォルダに書いていた (1 日で約 580 件)
if (!process.env.MEDIA_ROOT) {
  process.env.MEDIA_ROOT = path.join(os.tmpdir(), `tealus-test-media-${process.pid}`);
}

// ★ OpenAI の部品は読み込んだ瞬間に鍵を要求する。CI (.github/workflows/test.yml) と同じダミーを渡す (#468)
//   以前は本番の .env の本物の鍵が漏れてきて、たまたま通っていた
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = 'dummy-key-for-ci';
}

// ★★ CC ブリッジの受け箱もテスト用の一時フォルダにする (#650、docs/14 §10、2026-11-23)
//   既定の ~/.tealus/cc-queue はこの機械では本番の受け箱そのもので、配達役 (courier) が見ている。
//   受け付けを本体に移すと、本文に `@cc-` を含むテストの投稿が本番の受け箱に行を足し、**実在の班を起こす**
//   別名の設定 (cc-aliases.json) も本番の server/config/ を読まないよう、無いファイルを指しておく
if (!process.env.CC_QUEUE_DIR) {
  process.env.CC_QUEUE_DIR = path.join(os.tmpdir(), `tealus-test-cc-queue-${process.pid}`);
}
if (!process.env.CC_ALIASES_FILE) {
  process.env.CC_ALIASES_FILE = path.join(os.tmpdir(), `tealus-test-cc-aliases-${process.pid}.json`);
}
// ★ #650 の監査 5: CC_INTAKE は既定 (off) で固定する。本番の .env が CC_INTAKE=server になっても、この機械のテストだけ挙動が変わらないように。
//   CC_INTAKE を見るテストは自分で入れる (ccIntake.test.mts・ccQueueStream.test.mts)
process.env.CC_INTAKE = '';
