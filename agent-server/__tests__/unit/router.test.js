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
  DEEP_AVAILABLE: true,  // 既存テスト互換: claude CLI が常時あると見なす
}));

const config = require('../../src/config');
const { classifyByRules, classifyByLLM, route, applyDeepAvailability, stripLeadingMentions } = require('../../src/router/index');

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
      config.DEEP_AVAILABLE = true;
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

  describe('Deep availability — DEEP_AVAILABLE=false', () => {
    beforeEach(() => {
      mockCreate.mockReset();
      config.DEEP_AVAILABLE = false;
    });

    afterAll(() => {
      config.DEEP_AVAILABLE = true;
    });

    test('/deep 明示指定 → tier=unavailable（dispatcher が説明メッセージを返す想定）', async () => {
      const result = await route('/deep このコードをレビューして');
      expect(result.tier).toBe('unavailable');
      expect(result.prompt).toBe('このコードをレビューして');
    });

    test('DEEP_KEYWORDS マッチ → tier=light（silent fallback）', async () => {
      const result = await route('このコードをリファクタリングして');
      expect(result.tier).toBe('light');
    });

    test('LLM が deep を返す → tier=light（silent fallback）', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'deep' } }],
      });

      const result = await route('月次レポートをまとめて分析して');
      expect(result.tier).toBe('light');
    });

    test('Light の通常ケース → 影響なし', async () => {
      const result = await route('/light 在庫を確認');
      expect(result.tier).toBe('light');
      expect(result.prompt).toBe('在庫を確認');
    });

    test('挨拶パターンも影響なし（router 直接応答）', async () => {
      const result = await route('こんにちは');
      expect(result.tier).toBe('router');
    });
  });

  // ===========================================================
  // 標準 routing pattern 検証 template (5/8、#258 follow-up の経験を template 化)
  //
  // 背景: 5/7 dogfood で `/light2` を追加した時、DM (mention 不要) でしか test
  //   していなかったため group room (`@bot /light2 ...`) で v1 落ちする bug が
  //   発覚。新しい slash command を追加する時は (1) DM (2) group + mention
  //   (3) 複数 mention の 3 pattern を全部 cover する事で再発防止。
  //
  // 使い方: 新 command を追加したら下の COMMANDS 配列に entry 1 行追加するだけ。
  //   それで 3 pattern × N command の test が自動生成される。
  // ===========================================================
  describe('標準 routing pattern (commands × 3 pattern matrix)', () => {
    beforeEach(() => {
      mockCreate.mockReset();
      config.DEEP_AVAILABLE = true;
    });

    const COMMANDS = [
      { name: '/deep', tier: 'deep', samplePrompt: 'コードをレビュー' },
      { name: '/light', tier: 'light', samplePrompt: '在庫を確認' },
      { name: '/light2', tier: 'light2', samplePrompt: 'PDFを要約' },
    ];

    for (const { name, tier, samplePrompt } of COMMANDS) {
      describe(`${name} → ${tier}`, () => {
        test('(1) DM (mention なし) で振り分け', () => {
          const result = classifyByRules(`${name} ${samplePrompt}`);
          expect(result.tier).toBe(tier);
          expect(result.prompt).toBe(samplePrompt);
        });

        test('(2) group room (@bot mention 付き) で振り分け', () => {
          const result = classifyByRules(`@アシスタント ${name} ${samplePrompt}`);
          expect(result.tier).toBe(tier);
          expect(result.prompt).toBe(samplePrompt);
        });

        test('(3) 複数 mention でも振り分け', () => {
          const result = classifyByRules(`@user1 @bot ${name} ${samplePrompt}`);
          expect(result.tier).toBe(tier);
          expect(result.prompt).toBe(samplePrompt);
        });
      });
    }
  });

  describe('mention 付き入力 (group room、#258 follow-up)', () => {
    beforeEach(() => {
      mockCreate.mockReset();
      config.DEEP_AVAILABLE = true;
    });

    test('stripLeadingMentions: 単一 mention を除去', () => {
      expect(stripLeadingMentions('@アシスタント hello')).toBe('hello');
    });

    test('stripLeadingMentions: 複数 mention を除去', () => {
      expect(stripLeadingMentions('@user1 @bot /deep refactor')).toBe('/deep refactor');
    });

    test('stripLeadingMentions: mention なしは無加工', () => {
      expect(stripLeadingMentions('普通のメッセージ')).toBe('普通のメッセージ');
    });

    test('stripLeadingMentions: 文中の @ は除去しない', () => {
      expect(stripLeadingMentions('text with @mention inside')).toBe('text with @mention inside');
    });

    test('mention 付き /light2 を v2 に振り分け', () => {
      const result = classifyByRules('@アシスタント /light2 PDFを要約');
      expect(result.tier).toBe('light2');
      expect(result.prompt).toBe('PDFを要約');
    });

    test('mention 付き /deep を deep に振り分け', () => {
      const result = classifyByRules('@cc-tealus /deep このコードをレビュー');
      expect(result.tier).toBe('deep');
      expect(result.prompt).toBe('このコードをレビュー');
    });

    test('mention 付き /light を light に振り分け', () => {
      const result = classifyByRules('@アシスタント /light 在庫を確認');
      expect(result.tier).toBe('light');
      expect(result.prompt).toBe('在庫を確認');
    });

    test('複数 mention でも prefix 検出', () => {
      const result = classifyByRules('@user1 @bot /light2 hello');
      expect(result.tier).toBe('light2');
      expect(result.prompt).toBe('hello');
    });

    test('mention 付き greeting も router 直接応答', () => {
      const result = classifyByRules('@アシスタント こんにちは');
      expect(result.tier).toBe('router');
      expect(result.response).toBeTruthy();
    });

    test('mention 付き DEEP_KEYWORD も deep ヒント', () => {
      const result = classifyByRules('@アシスタント このコードをリファクタリングして');
      expect(result.tier).toBe('deep');
    });

    test('mention 付き /deep が DEEP_AVAILABLE=false で unavailable に変換', async () => {
      config.DEEP_AVAILABLE = false;
      try {
        const result = await route('@アシスタント /deep refactor');
        expect(result.tier).toBe('unavailable');
        expect(result.prompt).toBe('refactor');
      } finally {
        config.DEEP_AVAILABLE = true;
      }
    });

    test('mention 付き未知入力は LLM に stripped content を渡す', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'light' } }],
      });
      const result = await route('@アシスタント 来月の売上予測を教えて');
      expect(result.tier).toBe('light');
      expect(mockCreate).toHaveBeenCalledTimes(1);
      // LLM に渡された content は mention 除去済
      const callArg = mockCreate.mock.calls[0][0];
      const userMsg = callArg.messages.find(m => m.role === 'user');
      expect(userMsg.content).toBe('来月の売上予測を教えて');
    });
  });

  describe('applyDeepAvailability ヘルパー単体', () => {
    afterEach(() => {
      config.DEEP_AVAILABLE = true;
    });

    test('DEEP_AVAILABLE=true: deep tier をそのまま返す', () => {
      config.DEEP_AVAILABLE = true;
      const r = applyDeepAvailability({ tier: 'deep', prompt: 'x' }, true);
      expect(r.tier).toBe('deep');
    });

    test('DEEP_AVAILABLE=false + 非 deep tier はそのまま', () => {
      config.DEEP_AVAILABLE = false;
      const r = applyDeepAvailability({ tier: 'light', prompt: 'x' }, false);
      expect(r.tier).toBe('light');
    });
  });
});
