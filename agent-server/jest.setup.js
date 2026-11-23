/**
 * Jest セットアップ
 *
 * テスト実行環境では claude CLI の有無に依存せず、Deep agent が利用可能であると仮定する。
 * これにより CI（claude CLI が無い）でも本番想定のテストを通せる。
 *
 * config-deep-detection.test.js は個別に env を切り替えて検出ロジックをテストする。
 */
process.env.AGENT_DEEP_AVAILABLE_OVERRIDE = 'true';

// ★★ #572 テストは本番 DB につながない。
//   config.mts の dotenv.config() は .env (本番の DB 設定) を読むが、既にある変数は上書きしない。
//   sessionManager の pool は DATABASE_URL を最優先にするので、ここでテスト用の DB を先に決める。
//   (2026-10-10 17:15、DB を差し替え忘れたテストが本番の room_members に 'u1' を投げていた)
//   ★ テスト用の DB は server と同じ (docker の tealus_postgres_test、5433)。CI では届かず、今までどおり接続失敗になる
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://tealus_test:tealus_test@127.0.0.1:5433/tealus_test';

// ★★ #650 (docs/14 §10、2026-11-23) 受け箱もテスト用の一時フォルダにする。既定の ~/.tealus/cc-queue は
//   この機械では本番の受け箱で、配達役が見ている。本文に `@cc-` を含むテストが本番の受け箱に行と持ち主の札を書かないように。
//   ★ 個別のテストが自分で差し替えて afterEach / afterAll で delete するものがある (7 本)。どれも次の beforeEach で入れ直すか、
//     ファイルの最後の片付けなので、delete の後に既定 (本番の受け箱) へ書くテストは無い (2026-11-23 に grep で確かめた)
{
  const os = require('os');
  const path = require('path');
  if (!process.env.CC_QUEUE_DIR) process.env.CC_QUEUE_DIR = path.join(os.tmpdir(), `tealus-agent-test-cc-queue-${process.pid}`);
}

// ★ #650 の監査 5: CC_INTAKE も空で固定する。config.mts の dotenv は本番の .env を読み、既にある変数は上書きしない。
//   本番を CC_INTAKE=server に切り替えた後、この機械でだけ cc のテストが「受け付けない・410」に落ちる (CI では通る) のを防ぐ。
//   CC_INTAKE を見るテストは自分で入れる
process.env.CC_INTAKE = '';
