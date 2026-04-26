/**
 * Jest セットアップ
 *
 * テスト実行環境では claude CLI の有無に依存せず、Deep agent が利用可能であると仮定する。
 * これにより CI（claude CLI が無い）でも本番想定のテストを通せる。
 *
 * config-deep-detection.test.js は個別に env を切り替えて検出ロジックをテストする。
 */
process.env.AGENT_DEEP_AVAILABLE_OVERRIDE = 'true';
