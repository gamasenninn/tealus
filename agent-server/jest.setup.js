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
