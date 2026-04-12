/**
 * Light Agent
 * GPT-5.4-mini による日常タスク処理
 * 会話履歴 + メモリ をコンテキストとして使用
 */
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { loadMemoryForPrompt } = require('../memory/fileMemory');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const SYSTEM_PROMPT = `あなたはTealusのAIアシスタントです。
社内メッセンジャー上でチームメンバーとして対等に会話します。

## ルール
- 簡潔で自然な日本語で応答してください
- 質問には正確に答え、わからない場合は正直に伝えてください
- 必要に応じてツールを使用してください
- 複雑すぎるタスクは「このタスクは高度な分析が必要です」と伝えてください`;

/**
 * Light Agent でメッセージを処理
 */
async function processLight({ roomId, prompt, workspacePath }) {
  try {
    // 会話履歴を取得（DESC順で返るので逆順にする）
    const historyData = await botApi.getMessages(roomId, config.LIGHT_CONTEXT_MESSAGES);
    const history = (historyData.messages || []).reverse();

    // メモリを読み込み
    const memory = loadMemoryForPrompt(workspacePath);

    // メッセージ配列を構築
    const messages = buildMessages(history, memory, prompt);

    // LLM呼び出し
    const response = await openai.chat.completions.create({
      model: config.AGENT_LIGHT_MODEL,
      messages,
      max_tokens: 2000,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      await botApi.pushMessage(roomId, content);
      logger.info(`Light response sent to room ${roomId}`);
    }
  } catch (err) {
    logger.error(`Light Agent error: ${err.message}`);
    try {
      await botApi.pushMessage(roomId, `申し訳ございません。エラーが発生しました: ${err.message}`);
    } catch (pushErr) {
      logger.error(`Failed to send error message: ${pushErr.message}`);
    }
  }
}

/**
 * LLM用のメッセージ配列を構築
 */
function buildMessages(history, memory, prompt) {
  const messages = [];

  // システムプロンプト + メモリ
  let systemContent = SYSTEM_PROMPT;
  if (memory) {
    systemContent += `\n\n## 記憶\n${memory}`;
  }
  messages.push({ role: 'system', content: systemContent });

  // 会話履歴（古い順）
  const botUserId = require('../lib/botApi').getBotUserId();
  for (const msg of history) {
    // 音声メッセージは文字起こしテキストを使用
    const text = msg.content
      || msg.transcription?.formatted_text
      || msg.transcription?.raw_text;
    if (!text) continue;
    // Bot自身の発言は assistant、それ以外は user
    const isBot = msg.sender_id === botUserId;
    const role = isBot ? 'assistant' : 'user';
    const content = role === 'user'
      ? `${msg.sender_display_name}: ${text}`
      : text;
    messages.push({ role, content });
  }

  // 今回のプロンプト
  messages.push({ role: 'user', content: prompt });

  return messages;
}

module.exports = { processLight, buildMessages };
