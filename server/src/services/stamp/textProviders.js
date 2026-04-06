const logger = require('../../utils/logger');

const STAMP_LABELS = [
  '了解です', 'おはよう', 'OK!', 'おやすみ',
  'ごめんね', 'ありがとう', 'いいね！', '了解！',
  'うるうる', 'がんばります', 'ちらっ', 'ありがとうございました',
  'おつかれさま', 'ねむい', 'えっ!?', 'カンパーイ！',
];

/**
 * Build the system prompt for stamp prompt generation
 */
function buildSystemPrompt(labels) {
  const count = labels.length;
  const cols = 4;
  const rows = Math.ceil(count / cols);

  return `あなたはLINEスタンプのプロンプトデザイナーです。
ユーザーの入力を元に、画像生成AIに渡すための詳細なプロンプトを生成してください。

要件:
- 1536×1024pxの画像に${cols}×${rows}のグリッドレイアウト（${cols}列×${rows}行 = ${count}コマ）
- 各セルの間には薄いグレーの区切り線（1px）を入れる
- LINEスタンプ風のかわいいイラスト
- 各コマに日本語テキストを含める
- 統一されたキャラクターと画風
- シンプルな線画、明るい色使い
- 白背景
- キャラクターや文字がセルの境界をまたがないこと

${count}コマのテキスト（左上から右に順に）:
${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}

出力は画像生成AIに直接渡すプロンプト（英語）のみを返してください。説明や前置きは不要です。`;
}

/**
 * OpenAI text provider
 */
class OpenAITextProvider {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o';
  }

  async generateStampPrompt(userInput, labels = STAMP_LABELS) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(labels) },
          { role: 'user', content: userInput },
        ],
        max_tokens: 1000,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || 'Text generation failed');
    }

    return data.choices[0].message.content;
  }
}

/**
 * Factory function
 */
function createTextProvider(provider) {
  const apiKey = process.env.STAMP_TEXT_API_KEY || process.env.STAMP_IMAGE_API_KEY;
  const model = process.env.STAMP_TEXT_MODEL;

  switch (provider || 'openai') {
    case 'openai':
      return new OpenAITextProvider(apiKey, model);
    default:
      throw new Error(`Unknown text provider: ${provider}`);
  }
}

module.exports = { createTextProvider, STAMP_LABELS };
