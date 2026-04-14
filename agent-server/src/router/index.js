/**
 * Agent Router
 * 第1段: ルールベース分類
 * 第2段: GPT-5.4-mini による意図分類
 */
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../lib/logger');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// 挨拶パターン
const GREETING_PATTERNS = [
  { pattern: /^(こんにちは|こんばんは|おはよう|おはようございます)/i, response: 'こんにちは！何かお手伝いできることはありますか？' },
  { pattern: /^(おつかれ|お疲れ)/i, response: 'お疲れ様です！何かありましたら聞いてください。' },
  { pattern: /^(ありがとう|ありがと)/i, response: 'どういたしまして！他にも何かあればお気軽にどうぞ。' },
  { pattern: /^(やあ|ヤッホー|よう|ハロー)$/i, response: 'こんにちは！今日はどんなお手伝いをしましょうか？' },
  { pattern: /^(hello|hi)$/i, response: 'こんにちは！今日はどんなお手伝いをしましょうか？' },
];

// Deep キーワード（複雑なタスクのみ。ファイル操作はLightのMCPで対応）
const DEEP_KEYWORDS = [
  'コード', 'リファクタ', 'デバッグ', 'レビュー', '実装',
  'PR', 'プルリクエスト',
  'レポート作成', '戦略', '設計',
];

/**
 * 第1段: ルールベース分類
 * @returns {{ tier: string, prompt?: string, response?: string } | null}
 */
function classifyByRules(content) {
  const trimmed = content.trim();

  // /deep コマンド
  if (trimmed.startsWith('/deep ')) {
    return { tier: 'deep', prompt: trimmed.slice(6).trim() };
  }

  // /light コマンド
  if (trimmed.startsWith('/light ')) {
    return { tier: 'light', prompt: trimmed.slice(7).trim() };
  }

  // 挨拶パターン
  for (const { pattern, response } of GREETING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: 'router', response };
    }
  }

  // Deep キーワード
  for (const keyword of DEEP_KEYWORDS) {
    if (trimmed.includes(keyword)) {
      return { tier: 'deep', prompt: trimmed };
    }
  }

  // 判定不能
  return null;
}

/**
 * 第2段: LLM による分類
 * @returns {{ tier: string, prompt: string }}
 */
async function classifyByLLM(content) {
  try {
    const response = await openai.chat.completions.create({
      model: config.AGENT_ROUTER_MODEL,
      messages: [
        {
          role: 'system',
          content: `あなたはタスク分類器です。ユーザーの入力を分析し、"light" または "deep" のいずれかだけを返してください。

light: 簡単な質問、検索、翻訳、要約、計算、数値処理、データ分析、グラフ生成、ファイル一覧・読み書き、日常的なタスク（1〜数ステップ）
deep: 複雑なコード生成・リファクタリング・デバッグ、長いワークフロー、戦略立案

1単語だけ返してください。`,
        },
        { role: 'user', content },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const tier = response.choices[0]?.message?.content?.trim().toLowerCase();
    if (tier === 'deep') {
      return { tier: 'deep', prompt: content };
    }
    return { tier: 'light', prompt: content };
  } catch (err) {
    logger.error(`Router LLM error: ${err.message}`);
    // フォールバック: Lightに振る
    return { tier: 'light', prompt: content };
  }
}

/**
 * 統合ルーティング: 第1段 → 第2段
 */
async function route(content) {
  // 第1段: ルールベース
  const ruleResult = classifyByRules(content);
  if (ruleResult) {
    logger.debug(`Router (rules): ${ruleResult.tier}`);
    return ruleResult;
  }

  // 第2段: LLM分類
  const llmResult = await classifyByLLM(content);
  logger.debug(`Router (LLM): ${llmResult.tier}`);
  return llmResult;
}

module.exports = { classifyByRules, classifyByLLM, route };
