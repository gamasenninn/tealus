/**
 * config.js の DEEP_AVAILABLE 検出ロジックのテスト。
 * AGENT_DEEP_AVAILABLE_OVERRIDE による強制 override が機能することを確認する。
 *
 * config.js は require 時に検出を実行するため、テストごとに jest.resetModules() で
 * 再 require する。
 */

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

describe('config: DEEP_AVAILABLE 検出', () => {
  const originalOverride = process.env.AGENT_DEEP_AVAILABLE_OVERRIDE;

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.AGENT_DEEP_AVAILABLE_OVERRIDE;
    } else {
      process.env.AGENT_DEEP_AVAILABLE_OVERRIDE = originalOverride;
    }
    jest.resetModules();
  });

  test('AGENT_DEEP_AVAILABLE_OVERRIDE=true で強制 enabled', () => {
    process.env.AGENT_DEEP_AVAILABLE_OVERRIDE = 'true';
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.DEEP_AVAILABLE).toBe(true);
  });

  test('AGENT_DEEP_AVAILABLE_OVERRIDE=false で強制 disabled', () => {
    process.env.AGENT_DEEP_AVAILABLE_OVERRIDE = 'false';
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.DEEP_AVAILABLE).toBe(false);
  });
});
