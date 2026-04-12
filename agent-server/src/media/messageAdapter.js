/**
 * メッセージアダプター
 * メッセージタイプに応じてエージェント用のプロンプトを構築
 */
const logger = require('../lib/logger');

/**
 * Webhookペイロードのメッセージからエージェント用プロンプトを抽出
 * @param {object} message - Webhookのmessageオブジェクト
 * @returns {string} エージェントに渡すプロンプト
 */
function extractPromptFromMessage(message) {
  if (!message) return '';

  const type = message.type || 'text';
  const content = message.content || '';
  const sender = message.sender?.display_name || '不明';

  switch (type) {
    case 'text':
      return content;

    case 'voice':
      // 音声メッセージ: 文字起こしテキストを使用
      const transcription = message.transcription?.formatted_text
        || message.transcription?.raw_text;
      if (transcription) {
        return `[音声メッセージの文字起こし] ${transcription}`;
      }
      return '[音声メッセージ（文字起こし未完了）]';

    case 'image':
      // 画像メッセージ: キャプション + 画像通知
      if (content) {
        return `${content}\n[画像が添付されています]`;
      }
      return '[画像が送信されました。内容を説明してください]';

    case 'file':
      // ファイルメッセージ
      const fileName = message.media?.[0]?.file_name || '不明なファイル';
      if (content) {
        return `${content}\n[ファイル: ${fileName}]`;
      }
      return `[ファイルが送信されました: ${fileName}]`;

    case 'video':
      if (content) {
        return `${content}\n[動画が添付されています]`;
      }
      return '[動画が送信されました]';

    case 'system':
      // システムメッセージは無視
      return '';

    default:
      return content || `[${type}メッセージ]`;
  }
}

module.exports = { extractPromptFromMessage };
