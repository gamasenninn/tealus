/**
 * Router テスト
 */

// OpenAI をモック
jest.mock('@openai/agents', () => ({}));
const mockCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  AGENT_ROUTER_MODEL: 'gpt-5.4-mini',
  OPENAI_API_KEY: 'test-key',
}));

const { classifyByRules, classifyByLLM, route } = require('../../src/router/index');

describe('Router', () => {

  describe('classifyByRules（第1段: ルールベース）', () => {
    test('/deep コマンドは Deep に振り分け', () => {
      const result = classifyByRules('/deep このコードをレビューして');
      expect(result.tier).toBe('deep');
      expect(result.prompt).toBe('このコードをレビューして');
    });

    test('/light コマンドは Light に振り分け', () => {
      const result = classifyByRules('/light 在庫を確認して');
      expect(result.tier).toBe('light');
      expect(result.prompt).toBe('在庫を確認して');
    });

    test('挨拶パターンは Router 直接応答', () => {
      const greetings = ['こんにちは', 'おはよう', 'こんばんは', 'おつかれさま', 'ありがとう'];
      for (const g of greetings) {
        const result = classifyByRules(g);
        expect(result.tier).toBe('router');
        expect(result.response).toBeTruthy();
      }
    });

    test('Deep キーワードを含む場合は Deep ヒント', () => {
      const result = classifyByRules('このコードをリファクタリングして');
      expect(result.tier).toBe('deep');
    });

    test('判定不能は null を返す', () => {
      const result = classifyByRules('来月の売上はどうなりそう？');
      expect(result).toBeNull();
    });
  });

  describe('classifyByLLM（第2段: LLM分類）', () => {
    beforeEach(() => {
      mockCreate.mockReset();
    });

    test('LLMが light を返したら Light に振り分け', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'light' } }],
      });

      const result = await classifyByLLM('在庫を教えて');
      expect(result.tier).toBe('light');
    });

    test('LLMが deep を返したら Deep に振り分け', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'deep' } }],
      });

      const result = await classifyByLLM('月次レポートをまとめて分析して');
      expect(result.tier).toBe('deep');
    });

    test('LLM呼び出し失敗時は Light にフォールバック', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const result = await classifyByLLM('何かの質問');
      expect(result.tier).toBe('light');
    });
  });

  describe('route（統合ルーティング）', () => {
    beforeEach(() => {
      mockCreate.mockReset();
    });

    test('ルールベースで判定できたらLLMを呼ばない', async () => {
      const result = await route('こんにちは');
      expect(result.tier).toBe('router');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('ルールベースで判定不能ならLLMを呼ぶ', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'light' } }],
      });

      const result = await route('来月の売上予測を教えて');
      expect(result.tier).toBe('light');
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });
});
