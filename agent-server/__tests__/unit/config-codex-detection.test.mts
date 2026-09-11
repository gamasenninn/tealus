/**
 * config.js の Codex Deep 関連設定のテスト (#276)。
 * AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE による強制 override + DEEP_AGENT_PROVIDER /
 * DEEP_CODEX_AUTH / AGENT_DEEP_CODEX_MODEL の env 読み取りを確認する。
 *
 * config.js は require 時に検出を実行するため、テストごとに jest.resetModules() で
 * 再 require する。既存 config-deep-detection.test.js と同 pattern。
 */

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

// ★ dotenv は実環境 .env を load して process.env を上書きするため、
// test での process.env 操作と衝突する。test 内では no-op 化。
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('config: DEEP_CODEX_AVAILABLE 検出', () => {
  const originalOverride = process.env.AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE;

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE;
    } else {
      process.env.AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE = originalOverride;
    }
    jest.resetModules();
  });

  test('AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE=true で強制 enabled', () => {
    process.env.AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE = 'true';
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.DEEP_CODEX_AVAILABLE).toBe(true);
  });

  test('AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE=false で強制 disabled', () => {
    process.env.AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE = 'false';
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.DEEP_CODEX_AVAILABLE).toBe(false);
  });
});

describe('config: Deep Codex env 4 件', () => {
  const original = {
    provider: process.env.DEEP_AGENT_PROVIDER,
    auth: process.env.DEEP_CODEX_AUTH,
    model: process.env.AGENT_DEEP_CODEX_MODEL,
  };

  afterEach(() => {
    for (const [key, val] of Object.entries({
      DEEP_AGENT_PROVIDER: original.provider,
      DEEP_CODEX_AUTH: original.auth,
      AGENT_DEEP_CODEX_MODEL: original.model,
    })) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    jest.resetModules();
  });

  test('DEEP_AGENT_PROVIDER 未設定で default "claude"', () => {
    delete process.env.DEEP_AGENT_PROVIDER;
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.DEEP_AGENT_PROVIDER).toBe('claude');
  });

  test('DEEP_AGENT_PROVIDER=codex で override', () => {
    process.env.DEEP_AGENT_PROVIDER = 'codex';
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.DEEP_AGENT_PROVIDER).toBe('codex');
  });

  test('DEEP_CODEX_AUTH 未設定で default "subscription" (= ★ 課金 safety)', () => {
    delete process.env.DEEP_CODEX_AUTH;
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.DEEP_CODEX_AUTH).toBe('subscription');
  });

  test('DEEP_CODEX_AUTH=api-key で override', () => {
    process.env.DEEP_CODEX_AUTH = 'api-key';
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.DEEP_CODEX_AUTH).toBe('api-key');
  });

  /**
   * ★★★ 2026-09-11 に既定を gpt-5.4 → gpt-5.5 へ変えた。
   *   採用者環境 (v0.9) で Deep Codex が全面停止し、真因が当時の既定値だった
   *   (サポート班の報告 2026-09-10 / 採用者#2 が自力で特定)。
   * ★ ここで固定するのは「値そのもの」ではなく **「既知の使えないモデルを既定にしない」**。
   *   ★★ 値だけ書くと、また使えなくなったときにテストが「古い値を守る」側に回る。
   */
  test('AGENT_DEEP_CODEX_MODEL 未設定で default "gpt-5.5"', () => {
    delete process.env.AGENT_DEEP_CODEX_MODEL;
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.AGENT_DEEP_CODEX_MODEL).toBe('gpt-5.5');
  });

  test('★★ 既定値が「使えないと実測したモデル」になっていないこと', () => {
    delete process.env.AGENT_DEEP_CODEX_MODEL;
    jest.resetModules();
    const config = require('../../src/config');
    const { KNOWN_UNSUPPORTED_CODEX_MODELS } = require('../../src/utils/codexModelGuard.mts');
    expect(KNOWN_UNSUPPORTED_CODEX_MODELS).not.toContain(config.AGENT_DEEP_CODEX_MODEL);
  });

  test('★★★ 既定のままの環境は警告が出ない (★ 出たら既定が壊れている)', () => {
    delete process.env.AGENT_DEEP_CODEX_MODEL;
    delete process.env.AGENT_LIGHT_MODEL;
    jest.resetModules();
    const config = require('../../src/config');
    const { checkCodexModels } = require('../../src/utils/codexModelGuard.mts');
    expect(checkCodexModels({
      deepProvider: 'codex', deepAuth: 'subscription', deepModel: config.AGENT_DEEP_CODEX_MODEL,
    })).toHaveLength(0);
  });
});
