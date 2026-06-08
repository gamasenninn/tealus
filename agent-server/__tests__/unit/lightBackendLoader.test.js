/**
 * #292 lightBackendLoader test
 *
 * 'v1' / 'v2' / unknown silent fallback / 絶対 path 不在 / processLight export なし / cache。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('loadLightBackend (#292)', () => {
  let loader;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    // require 順序: logger → loader
    logger = require('../../src/lib/logger');
    loader = require('../../src/agents/lightBackendLoader');
    loader.resetForTest();
  });

  test("default (= undefined) → 'v1' alias 解決、processLight が function", () => {
    const b = loader.loadLightBackend(undefined);
    expect(b.name).toBe('v1');
    expect(typeof b.processLight).toBe('function');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("resolved alias 'v1'"));
  });

  test("'v2' alias → lightV2 解決、processLight が function", () => {
    const b = loader.loadLightBackend('v2');
    expect(b.name).toBe('v2');
    expect(typeof b.processLight).toBe('function');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("resolved alias 'v2'"));
  });

  test("unknown alias 'v99' → silent fallback to 'v1' + warn log", () => {
    const b = loader.loadLightBackend('v99');
    expect(b.name).toBe('v1');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unknown spec 'v99'"));
  });

  test('絶対 path で file 不在 → silent fallback to v1 + error log', () => {
    const fakePath = path.join(os.tmpdir(), `does-not-exist-${Date.now()}.js`);
    const b = loader.loadLightBackend(fakePath);
    expect(b.name).toBe('v1');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('file not found'));
  });

  test('絶対 path で processLight export なし → silent fallback to v1 + error log', () => {
    // tmp file に processLight 無い module 作って絶対 path 指定
    const tmpFile = path.join(os.tmpdir(), `light-no-export-${Date.now()}.js`);
    fs.writeFileSync(tmpFile, 'module.exports = { somethingElse: () => {} };');
    try {
      const b = loader.loadLightBackend(tmpFile);
      expect(b.name).toBe('v1');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('missing processLight export'));
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test('cache: 同 spec 2 回目は 1 回目と同 object を返す (= require 重複なし)', () => {
    const b1 = loader.loadLightBackend('v2');
    const b2 = loader.loadLightBackend('v2');
    expect(b1).toBe(b2); // ★ 同 reference (= cache hit)
  });

  test('resetForTest 後は 新 backend を解決 (= cache clear 動作確認)', () => {
    const b1 = loader.loadLightBackend('v1');
    loader.resetForTest();
    const b2 = loader.loadLightBackend('v2');
    expect(b1.name).toBe('v1');
    expect(b2.name).toBe('v2');
    expect(b1).not.toBe(b2);
  });
});
