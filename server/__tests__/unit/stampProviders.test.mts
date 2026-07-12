/**
 * Unit tests for stamp provider factories
 * #221: OPENAI_API_KEY fallback chain
 */

describe('stamp provider env fallback (#221)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.STAMP_TEXT_API_KEY;
    delete process.env.STAMP_IMAGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('createTextProvider', () => {
    it('STAMP_TEXT_API_KEY が最優先', () => {
      process.env.STAMP_TEXT_API_KEY = 'sk-text-key';
      process.env.STAMP_IMAGE_API_KEY = 'sk-image-key';
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      const { createTextProvider } = require('../../src/services/stamp/textProviders');
      const provider = createTextProvider('openai');
      expect(provider.apiKey).toBe('sk-text-key');
    });

    it('STAMP_TEXT_API_KEY 未設定なら STAMP_IMAGE_API_KEY にフォールバック', () => {
      process.env.STAMP_IMAGE_API_KEY = 'sk-image-key';
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      const { createTextProvider } = require('../../src/services/stamp/textProviders');
      const provider = createTextProvider('openai');
      expect(provider.apiKey).toBe('sk-image-key');
    });

    it('STAMP_TEXT/IMAGE_API_KEY 両方未設定なら OPENAI_API_KEY にフォールバック', () => {
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      const { createTextProvider } = require('../../src/services/stamp/textProviders');
      const provider = createTextProvider('openai');
      expect(provider.apiKey).toBe('sk-openai-key');
    });

    it('全て未設定なら apiKey は undefined', () => {
      const { createTextProvider } = require('../../src/services/stamp/textProviders');
      const provider = createTextProvider('openai');
      expect(provider.apiKey).toBeUndefined();
    });
  });

  describe('createImageProvider', () => {
    it('STAMP_IMAGE_API_KEY が最優先', () => {
      process.env.STAMP_IMAGE_API_KEY = 'sk-image-key';
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      const { createImageProvider } = require('../../src/services/stamp/imageProviders');
      const provider = createImageProvider('openai');
      expect(provider.apiKey).toBe('sk-image-key');
    });

    it('STAMP_IMAGE_API_KEY 未設定なら OPENAI_API_KEY にフォールバック', () => {
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      const { createImageProvider } = require('../../src/services/stamp/imageProviders');
      const provider = createImageProvider('openai');
      expect(provider.apiKey).toBe('sk-openai-key');
    });

    it('全て未設定なら apiKey は undefined', () => {
      const { createImageProvider } = require('../../src/services/stamp/imageProviders');
      const provider = createImageProvider('openai');
      expect(provider.apiKey).toBeUndefined();
    });
  });
});
