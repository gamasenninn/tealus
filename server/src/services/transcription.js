const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const pool = require('../db/pool');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'whisper-1';
const MEDIA_ROOT = path.join(__dirname, '../../../media');

/**
 * Transcribe a voice message using OpenAI Whisper API
 * Runs asynchronously — does not block the upload response
 */
async function transcribeVoiceMessage(messageId, filePath, io, roomId) {
  const fullPath = path.join(MEDIA_ROOT, filePath);

  try {
    // Update status to transcribing
    await pool.query(
      `UPDATE voice_transcriptions SET status = 'transcribing' WHERE message_id = $1`,
      [messageId]
    );

    // Notify clients
    if (io) {
      io.to(roomId).emit('voice:status', { message_id: messageId, status: 'transcribing' });
    }

    // Call Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(fullPath),
      model: WHISPER_MODEL,
      language: 'ja',
    });

    const rawText = transcription.text;

    // Update transcription record
    await pool.query(
      `UPDATE voice_transcriptions SET status = 'done', raw_text = $1 WHERE message_id = $2`,
      [rawText, messageId]
    );

    // Notify clients with result
    if (io) {
      io.to(roomId).emit('voice:transcription', {
        message_id: messageId,
        status: 'done',
        raw_text: rawText,
      });
    }

    return rawText;
  } catch (err) {
    console.error('Transcription error:', err);

    await pool.query(
      `UPDATE voice_transcriptions SET status = 'error' WHERE message_id = $1`,
      [messageId]
    );

    if (io) {
      io.to(roomId).emit('voice:status', { message_id: messageId, status: 'error' });
    }

    return null;
  }
}

module.exports = { transcribeVoiceMessage };
