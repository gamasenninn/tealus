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
 * 先頭の @mention を除去する。
 *
 * Tealus の bot は group room で `@<bot_name>` mention 付きで呼ばれる
 * (DM は mention 不要)。mention が prefix 判定の前に居ると
 * `@アシスタント /light2 hello` のような入力で `/light2` 検出が失敗し、
 * LLM 振り分けに fallback して v1 に流れてしまう (実機 #258 dogfood で発覚)。
 *
 * 1 個以上の `@<word> ` を strip して実 content に対して prefix /
 * 挨拶 / DEEP_KEYWORDS 判定を行う。
 *
 * 例:
 *   "@アシスタント /light2 hello"        → "/light2 hello"
 *   "@user1 @bot /deep refactor"        → "/deep refactor"
 *   "@cc-tealus こんにちは"              → "こんにちは"
 */
function stripLeadingMentions(content) {
  return content.trim().replace(/^(?:@\S+\s+)+/, '');
}

/**
 * 第1段: ルールベース分類
 * @returns {{ tier: string, prompt?: string, response?: string } | null}
 */
function classifyByRules(content) {
  const trimmed = stripLeadingMentions(content);

  // /deep コマンド
  if (trimmed.startsWith('/deep ')) {
    return { tier: 'deep', prompt: trimmed.slice(6).trim() };
  }

  // /light コマンド
  if (trimmed.startsWith('/light ')) {
    return { tier: 'light', prompt: trimmed.slice(7).trim() };
  }

  // #258 /light2 コマンド (codex-sdk backed)
  // TODO(#292): config 化 (AGENT_LIGHT_BACKEND=v2) で V2 動作可能になったため、staging 期間後 deprecation 候補。
  // 現状はベータ user の習慣互換のため維持 (= /light2 は config と独立で常に V2 path に流れる)
  if (trimmed.startsWith('/light2 ')) {
    return { tier: 'light2', prompt: trimmed.slice(8).trim() };
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
      // #256: max_tokens は新 model (o1/o3/gpt-5 系) で reject される、
      // max_completion_tokens に rename。旧 model (gpt-4o 系) も両対応。
      max_completion_tokens: 10,
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
 * Deep agent の可用性に応じて tier を変換する。
 * provider (#276) に応じた CLI availability を check する:
 *   - DEEP_AGENT_PROVIDER='claude' (default): config.DEEP_AVAILABLE
 *   - DEEP_AGENT_PROVIDER='codex':           config.DEEP_CODEX_AVAILABLE
 *
 * 可用性なし時:
 *   - isExplicitDeep (/deep 指定) → 'unavailable' に変換 (dispatcher が説明メッセージを返す、provider field 付き)
 *   - それ以外 (キーワード/LLM) → 'light' に silent fallback
 */
function applyDeepAvailability(result, isExplicitDeep) {
  const provider = config.DEEP_AGENT_PROVIDER || 'claude';
  const available = provider === 'codex' ? config.DEEP_CODEX_AVAILABLE : config.DEEP_AVAILABLE;

  if (available) return result;
  if (result.tier !== 'deep') return result;

  if (isExplicitDeep) {
    return { ...result, tier: 'unavailable', provider };
  }
  logger.debug(`Router: deep fallback to light (${provider} CLI unavailable)`);
  return { ...result, tier: 'light' };
}

/**
 * 統合ルーティング: 第1段 → 第2段
 */
async function route(content) {
  const stripped = stripLeadingMentions(content);
  const isExplicitDeep = stripped.startsWith('/deep ');

  // 第1段: ルールベース
  const ruleResult = classifyByRules(content);
  if (ruleResult) {
    const adjusted = applyDeepAvailability(ruleResult, isExplicitDeep);
    logger.debug(`Router (rules): ${adjusted.tier}`);
    return adjusted;
  }

  // 第2段: LLM分類 (mention 除去後の content で intent 判定して noise 排除)
  const llmResult = await classifyByLLM(stripped);
  // LLM 経由は明示指定ではないので silent fallback のみ
  const adjusted = applyDeepAvailability(llmResult, false);
  logger.debug(`Router (LLM): ${adjusted.tier}`);
  return adjusted;
}

module.exports = {
  classifyByRules,
  classifyByLLM,
  route,
  applyDeepAvailability,
  stripLeadingMentions,
};
