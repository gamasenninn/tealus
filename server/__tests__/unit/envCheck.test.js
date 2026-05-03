/**
 * Unit tests for runStartupEnvCheck (#228)
 */

const { runStartupEnvCheck, checkOpenAIApiKey, isEmpty } = require('../../src/utils/envCheck');

function createMockLogger() {
  return {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  };
}

describe('envCheck (#228)', () => {
  describe('isEmpty', () => {
    it('undefined / null / empty string / 空白のみは empty', () => {
      expect(isEmpty(undefined)).toBe(true);
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty('')).toBe(true);
      expect(isEmpty('   ')).toBe(true);
      expect(isEmpty('\n')).toBe(true);
    });

    it('有効値は empty ではない', () => {
      expect(isEmpty('sk-abc')).toBe(false);
      expect(isEmpty('a')).toBe(false);
    });
  });

  describe('checkOpenAIApiKey', () => {
    it('OPENAI_API_KEY 空なら warn を呼ぶ', () => {
      const logger = createMockLogger();
      const fired = checkOpenAIApiKey(logger, { OPENAI_API_KEY: '' });
      expect(fired).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
      const warnCalls = logger.warn.mock.calls.map(c => c[0]).join('\n');
      expect(warnCalls).toContain('OPENAI_API_KEY is not set');
      expect(warnCalls).toContain('解決方法');
    });

    it('OPENAI_API_KEY 未設定でも warn を呼ぶ', () => {
      const logger = createMockLogger();
      const fired = checkOpenAIApiKey(logger, {});
      expect(fired).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('OPENAI_API_KEY 有効値なら warn を呼ばない', () => {
      const logger = createMockLogger();
      const fired = checkOpenAIApiKey(logger, { OPENAI_API_KEY: 'sk-abc123' });
      expect(fired).toBe(false);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('OPENAI_API_KEY が空白のみでも空扱いで warn を呼ぶ', () => {
      const logger = createMockLogger();
      const fired = checkOpenAIApiKey(logger, { OPENAI_API_KEY: '   ' });
      expect(fired).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('runStartupEnvCheck', () => {
    it('全て有効値なら warnings 配列は空', () => {
      const logger = createMockLogger();
      const warnings = runStartupEnvCheck(logger, { OPENAI_API_KEY: 'sk-abc' });
      expect(warnings).toEqual([]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('OPENAI_API_KEY 空なら warnings に含まれる', () => {
      const logger = createMockLogger();
      const warnings = runStartupEnvCheck(logger, { OPENAI_API_KEY: '' });
      expect(warnings).toContain('OPENAI_API_KEY');
    });
  });
});
