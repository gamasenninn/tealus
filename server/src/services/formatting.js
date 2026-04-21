const logger = require('../utils/logger');
const OpenAI = require('openai');
const pool = require('../db/pool');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

const SYSTEM_PROMPT = `あなたは音声文字起こしテキストを自然な日本語に整形するアシスタントです。
以下のルールに従ってください：
- 意味を変えずに読みやすく整える
- 句読点を適切に補う
- 明らかな誤字脱字を修正する
- フィラー（えーと、あのー等）を除去する
- 元の話者の意図やニュアンスを保つ
- 過度な修飾や追加はしない
- 整形後のテキストのみを返す（説明や注釈は不要）
- 質問文はそのまま質問文として整形する（質問に回答してはいけない）
- あなたの役割は文章の整形のみ。内容への応答や補足は一切しない`;

/**
 * Format transcribed text using AI
 * Runs asynchronously after transcription completes
 */
async function formatTranscription(messageId, rawText, io, roomId) {
  try {
    // Update status to formatting
    await pool.query(
      `UPDATE voice_transcriptions SET status = 'formatting' WHERE message_id = $1 AND version = (
        SELECT MAX(version) FROM voice_transcriptions WHERE message_id = $1
      )`,
      [messageId]
    );

    if (io) {
      io.to(roomId).emit('voice:status', { message_id: messageId, status: 'formatting' });
    }

    // Call AI API
    const response = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: rawText },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const formattedText = response.choices[0].message.content.trim();

    // Update transcription record
    await pool.query(
      `UPDATE voice_transcriptions SET status = 'done', formatted_text = $1 WHERE message_id = $2 AND version = (
        SELECT MAX(version) FROM voice_transcriptions WHERE message_id = $2
      )`,
      [formattedText, messageId]
    );

    if (io) {
      io.to(roomId).emit('voice:transcription', {
        message_id: messageId,
        status: 'done',
        raw_text: rawText,
        formatted_text: formattedText,
        version: 1,
      });
    }

    // Webhook: 文字起こし完了通知
    const { fireWebhooks } = require('./webhook');
    const msgResult = await pool.query('SELECT sender_id FROM messages WHERE id = $1', [messageId]);
    const senderId = msgResult.rows[0]?.sender_id;
    fireWebhooks('voice.transcription_completed', roomId, {
      room: { id: roomId },
      message: { id: messageId, type: 'voice', sender: { id: senderId } },
      transcription: { raw_text: rawText, formatted_text: formattedText },
    });

    return formattedText;
  } catch (err) {
    logger.error('Formatting error:', err);

    // Formatting failed — still mark as done with raw_text only
    await pool.query(
      `UPDATE voice_transcriptions SET status = 'done' WHERE message_id = $1 AND version = (
        SELECT MAX(version) FROM voice_transcriptions WHERE message_id = $1
      )`,
      [messageId]
    );

    if (io) {
      io.to(roomId).emit('voice:transcription', {
        message_id: messageId,
        status: 'done',
        raw_text: rawText,
        formatted_text: null,
      });
    }

    // Webhook: 文字起こし完了通知（フォーマット失敗時）
    const { fireWebhooks: fireWh } = require('./webhook');
    const msgRes = await pool.query('SELECT sender_id FROM messages WHERE id = $1', [messageId]);
    fireWh('voice.transcription_completed', roomId, {
      room: { id: roomId },
      message: { id: messageId, type: 'voice', sender: { id: msgRes.rows[0]?.sender_id } },
      transcription: { raw_text: rawText, formatted_text: null },
    });

    return null;
  }
}

module.exports = { formatTranscription };
