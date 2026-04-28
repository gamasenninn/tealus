const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const pool = require('../db/pool');
const { formatTranscription } = require('./formatting');
const { loadGuideline, buildWhisperPrompt } = require('./transcriptionConfig');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'whisper-1';
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, '../../../media');

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

    // Detect actual file type for correct extension
    const { fileTypeFromFile } = await import('file-type');
    const fileInfo = await fileTypeFromFile(fullPath);
    let ext = fileInfo ? fileInfo.ext : path.extname(fullPath).replace('.', '') || 'webm';
    // Ensure Whisper-compatible extension
    const whisperFormats = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];
    if (!whisperFormats.includes(ext)) {
      ext = 'webm'; // fallback
    }

    // Convert to mp3 via ffmpeg if format is unrecognized
    let inputPath = fullPath;
    let tempPath = null;
    if (!fileInfo) {
      tempPath = fullPath + '.converted.mp3';
      try {
        const { execSync } = require('child_process');
        execSync(`ffmpeg -i "${fullPath}" -y -q:a 2 "${tempPath}" 2>/dev/null`);
        inputPath = tempPath;
        ext = 'mp3';
      } catch (e) {
        // ffmpeg conversion failed, try original
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        tempPath = null;
      }
    }

    // Call Whisper API — use File object with correct name for content-type detection
    const fileBuffer = fs.readFileSync(inputPath);
    const file = new File([fileBuffer], `voice.${ext}`, {
      type: ext === 'mp3' ? 'audio/mpeg' : ext === 'mp4' ? 'audio/mp4' : `audio/${ext}`,
    });

    const whisperPrompt = buildWhisperPrompt(loadGuideline());
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: WHISPER_MODEL,
      language: 'ja',
      ...(whisperPrompt ? { prompt: whisperPrompt } : {}),
    });

    const rawText = transcription.text;

    // Save raw text, proceed to formatting
    await pool.query(
      `UPDATE voice_transcriptions SET raw_text = $1 WHERE message_id = $2`,
      [rawText, messageId]
    );

    // Notify clients with raw text while formatting continues
    if (io) {
      io.to(roomId).emit('voice:transcription', {
        message_id: messageId,
        status: 'formatting',
        raw_text: rawText,
      });
    }

    // Cleanup temp file
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

    // AI formatting
    await formatTranscription(messageId, rawText, io, roomId);

    return rawText;
  } catch (err) {
    logger.error('Transcription error:', err);
    // Cleanup temp file on error
    if (typeof tempPath !== 'undefined' && tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

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
