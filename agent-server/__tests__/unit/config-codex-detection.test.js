/**
 * config.js の Codex Deep 関連設定のテスト (#276)。
 * AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE による強制 override + DEEP_AGENT_PROVIDER /
 * DEEP_CODEX_AUTH / AGENT_DEEP_CODEX_MODEL の env 読み取りを確認する。
 *
 * config.js は require 時に検出を実行するため、テストごとに jest.resetModules() で
 * 再 require する。既存 config-deep-detection.test.js と同 pattern。
 */

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

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

  test('AGENT_DEEP_CODEX_MODEL 未設定で default "gpt-5.4"', () => {
    delete process.env.AGENT_DEEP_CODEX_MODEL;
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.AGENT_DEEP_CODEX_MODEL).toBe('gpt-5.4');
  });
});
